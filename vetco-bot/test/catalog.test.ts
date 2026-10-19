import { createScheduledController, env } from 'cloudflare:test';
import { afterEach, describe, expect, it, vi } from 'vitest';
import sampleCsv from '../catalog/vetco_katalog.csv?raw';
import { parseCatalog, parseCsv } from '../src/catalog';
import worker, { CRON_RETRY, CRON_SYNC } from '../src/index';
import { api, call, mockNetwork } from './helpers';

afterEach(() => {
  vi.restoreAllMocks();
});

const HEADER =
  'id,sort,category,category_uz,category_ru,name,name_ru,maker,form_uz,form_ru,ingredient,description_uz,description_ru,dose_uz,dose_ru,dose_verified,unit_uz,unit_ru,price,in_stock,active,photo_url,alternatives';

describe('CSV parsing', () => {
  it('handles quotes, escaped quotes, CRLF, BOM and newlines inside fields', () => {
    const rows = parseCsv('﻿a,b,c\r\n"x, y","say ""hi""","line1\nline2"\r\n\r\n');
    expect(rows).toEqual([
      ['a', 'b', 'c'],
      ['x, y', 'say "hi"', 'line1\nline2'],
    ]);
  });

  it('parses the sample sheet that ships with the bot', () => {
    const { rows, errors } = parseCatalog(sampleCsv);
    expect(errors).toEqual([]);
    expect(rows).toHaveLength(9);
    expect(rows.filter((r) => r.active).map((r) => r.id)).toEqual(['bistrepen', 'kefen', 'fluneks', 'butofan', 'fosbevit']);
    expect(rows.every((r) => r.dose_verified === 0 && r.price === null)).toBe(true);
    expect(rows.find((r) => r.id === 'kefen')!.alternatives).toBe('fluneks');
  });

  it('matches the seed migration', async () => {
    const { results } = await env.DB.prepare('SELECT * FROM products ORDER BY sort').all<Record<string, unknown>>();
    const { rows } = parseCatalog(sampleCsv);
    for (const row of rows) {
      const db = results.find((r) => r.id === row.id);
      expect(db, row.id).toBeDefined();
      for (const [key, value] of Object.entries(row)) expect(db![key], `${row.id}.${key}`).toEqual(value);
    }
  });

  it('reports bad rows and keeps the good ones', () => {
    const csv = [
      HEADER,
      'ok1,1,vit,,,Good,,,,,,,,,,,,,"125 000 soʻm",ha,ha,,',
      'Bad Id,2,vit,,,X,,,,,,,,,,,,,,,,,',
      'ok2,3,vit,,,,,,,,,,,,,,,,,,,,',
      'ok3,4,vit,,,Price,,,,,,,,,,,,,12.5,,,,',
      'ok4,5,vit,,,Bool,,,,,,,,,,,,,,maybe,,,',
      'ok5,6,vit,,,Photo,,,,,,,,,,,,,,,,http://insecure.example/x.jpg,',
      'ok1,7,vit,,,Dup,,,,,,,,,,,,,,,,,',
    ].join('\n');
    const { rows, errors } = parseCatalog(csv);
    expect(rows.map((r) => r.id)).toEqual(['ok1', 'ok5']);
    expect(rows[0]!.price).toBe(125000);
    expect(rows[1]!.photo_url).toBeNull();
    expect(errors).toHaveLength(6);
    expect(errors.join('\n')).toMatch(/3-qator.*notoʻgʻri/);
    expect(errors.join('\n')).toMatch(/takrorlangan/);
  });

  it('accepts common price spellings', () => {
    const price = (p: string) => parseCatalog(`${HEADER}\nx,1,c,,,X,,,,,,,,,,,,,"${p}",,,,`).rows[0]?.price;
    expect(price('125000')).toBe(125000);
    expect(price('125,000')).toBe(125000);
    expect(price('125 000.00')).toBe(125000);
    expect(price('1 250 000 сум')).toBe(1250000);
    expect(price('0')).toBeNull();
    expect(price('')).toBeNull();
    expect(price('12,5')).toBeUndefined();
  });

  it('requires the id, name and category columns', () => {
    expect(parseCatalog('name,price\nX,1').errors[0]).toContain('"id"');
  });
});

describe('catalog sync', () => {
  it('needs the admin token', async () => {
    mockNetwork();
    expect((await api('/api/sync', { method: 'POST' }, 'wrong')).status).toBe(401);
    expect((await call(new Request('https://bot.test/api/orders'))).status).toBe(401);
  });

  it('replaces the catalog from the sheet and deactivates missing products', async () => {
    const csv = [
      HEADER,
      'bistrepen,10,antibiotik,Antibiotiklar,Антибиотики,Bistrepen,Бистрепен,Brovafarma,,,,,,,,,flakon,флакон,98000,ha,ha,,',
      'yangi,15,antibiotik,Antibiotiklar,Антибиотики,Yangi preparat,,,,,,,,,,,,,,yoʻq,ha,,',
    ].join('\n');
    mockNetwork({ csv });
    const res = await api('/api/sync', { method: 'POST' });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, total: 2, active: 2 });
    const { results } = await env.DB.prepare('SELECT id, price, in_stock FROM products WHERE active = 1 ORDER BY sort').all();
    expect(results).toEqual([
      { id: 'bistrepen', price: 98000, in_stock: 1 },
      { id: 'yangi', price: null, in_stock: 0 },
    ]);
    const health = (await (await call(new Request('https://bot.test/health'))).json()) as { products: number; catalog_synced_at: string };
    expect(health.products).toBe(2);
    expect(health.catalog_synced_at).toBeTruthy();
  });

  it('never wipes the catalog with an empty or broken sheet', async () => {
    const before = await env.DB.prepare('SELECT COUNT(*) AS n FROM products WHERE active = 1').first<{ n: number }>();
    for (const csv of ['', `${HEADER}\n`, '<!DOCTYPE html><html>login</html>']) {
      vi.restoreAllMocks();
      mockNetwork({ csv });
      const res = await api('/api/sync', { method: 'POST' });
      expect(res.status).toBe(422);
    }
    vi.restoreAllMocks();
    mockNetwork(); // 404
    expect((await api('/api/sync', { method: 'POST' })).status).toBe(422);
    const after = await env.DB.prepare('SELECT COUNT(*) AS n FROM products WHERE active = 1').first<{ n: number }>();
    expect(after!.n).toBe(before!.n);
  });

  it('runs on the daily cron and retries unsent order cards', async () => {
    const net = mockNetwork({ csv: `${HEADER}\nkefen,1,ogriq,,,Kefen,,,,,,,,,,,,,,,,,` });
    const old = new Date(Date.now() - 10 * 60_000).toISOString();
    const { meta } = await env.DB.prepare(
      `INSERT INTO orders (chat_id, lang, customer_name, phone, region, address, items, status, created_at, updated_at)
       VALUES (31, 'uz', 'Retry', '+998900000000', 'tsh', 'x', '[]', 'new', ?, ?)`,
    )
      .bind(old, old)
      .run();
    // 03:00: both crons fire. The sync one only syncs, so the card is not sent twice.
    await Promise.all([
      worker.scheduled(createScheduledController({ cron: CRON_SYNC }), env),
      worker.scheduled(createScheduledController({ cron: CRON_RETRY }), env),
    ]);
    const active = await env.DB.prepare('SELECT id FROM products WHERE active = 1').all();
    expect(active.results).toEqual([{ id: 'kefen' }]);
    const order = await env.DB.prepare('SELECT admin_message_id FROM orders WHERE id = ?').bind(meta.last_row_id).first<{ admin_message_id: number | null }>();
    expect(order!.admin_message_id).not.toBeNull();
    expect(net.of('sendMessage').filter((c) => String(c.params.text).includes('Retry'))).toHaveLength(1);

    // The 15-minute cron does not touch the catalog, and a sent card is not sent again.
    net.clear();
    await worker.scheduled(createScheduledController({ cron: CRON_RETRY }), env);
    expect(net.calls).toHaveLength(0);
  });
});

describe('orders API and setup', () => {
  it('exports orders as JSON and spreadsheet-safe CSV', async () => {
    mockNetwork();
    const now = new Date().toISOString();
    await env.DB.prepare(
      `INSERT INTO orders (chat_id, lang, customer_name, phone, region, address, items, total, status, created_at, updated_at)
       VALUES (41, 'ru', '=HYPERLINK("x")', '+998900000001', 'sam', 'Urgut, "Bogʻ"', ?, 90000, 'new', ?, ?)`,
    )
      .bind(JSON.stringify([{ id: 'kefen', name: 'Kefen', name_ru: null, qty: 2, price: 45000, unit_uz: null, unit_ru: null }]), now, now)
      .run();
    const json = (await (await api('/api/orders?since_id=0&limit=500')).json()) as { orders: { customer_name: string }[] };
    expect(json.orders.some((o) => o.customer_name === '=HYPERLINK("x")')).toBe(true);
    const csv = await (await api('/api/orders?format=csv')).text();
    expect(csv).toContain(`"'=HYPERLINK(""x"")"`);
    expect(csv).toContain('Kefen × 2');
    expect(csv).toContain('Samarqand viloyati');
  });

  it('registers the webhook with the secret', async () => {
    const net = mockNetwork();
    const res = await api('/api/setup', { method: 'POST' });
    expect(res.status).toBe(200);
    const hook = net.of('setWebhook')[0]!;
    expect(hook.params).toMatchObject({ url: 'https://bot.test/telegram', secret_token: 'test-secret-0123456789' });
    const scopes = net.of('setMyCommands').map((c) => `${c.params.scope?.type ?? 'default'}:${c.params.language_code ?? ''}`);
    expect(scopes).toEqual(['all_private_chats:', 'all_private_chats:ru', 'default:', 'chat:']);
    expect(net.of('setMyCommands')[2]!.params.commands).toEqual([]);
    expect(net.of('getChat')[0]!.params.chat_id).toBe('-100777');
  });

  it('renders the public catalog page with escaped text and deep links', async () => {
    mockNetwork({ csv: sampleCsv });
    expect((await api('/api/sync', { method: 'POST' })).status).toBe(200);
    await env.DB.prepare("UPDATE products SET description_uz = '<script>alert(1)</script>' WHERE id = 'butofan'").run();
    const res = await call(new Request('https://bot.test/'));
    const html = await res.text();
    expect(res.headers.get('Content-Type')).toContain('text/html');
    expect(html).toContain('Butofan');
    expect(html).toContain('https://t.me/vetco_test_bot?start=p_butofan');
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;');
    const ru = await (await call(new Request('https://bot.test/?lang=ru'))).text();
    expect(ru).toContain('Бутофан');
  });
});
