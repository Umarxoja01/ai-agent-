import type { Env } from './env';
import * as db from './db';
import { ADMIN_CHAT_OVERRIDE, adminChatId, notifyNewOrder, withAdminChatOverride } from './admin';
import { handleUpdate } from './bot';
import { syncCatalog } from './catalog';
import { pushOrder, sheetRow } from './sheets';
import { TgError, tg, type TgUpdate } from './tg';
import { bearerOk, json, nowIso, safeEqual } from './util';
import { catalogPage, productImage } from './web';

export const CRON_SYNC = '0 3 * * *'; // 08:00 Tashkent
export const CRON_RETRY = '*/15 * * * *';

export default {
  async fetch(request: Request, env: Env, exec: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, '') || '/';
    try {
      if (path === '/telegram') return await telegramWebhook(request, env, exec);
      if (request.method === 'GET' && path === '/') return await catalogPage(env, url);
      if (request.method === 'GET' && path.startsWith('/img/')) return await productImage(env, path.slice(5), request, exec);
      if (request.method === 'GET' && path === '/health') return await health(env);
      if (path.startsWith('/api/')) return await api(request, env, url, path);
      return new Response('Not found', { status: 404 });
    } catch (err) {
      console.error(`${request.method} ${path}: ${err instanceof Error ? err.stack ?? err.message : err}`);
      return json({ ok: false, error: 'internal error' }, 500);
    }
  },

  async scheduled(controller: ScheduledController, env: Env): Promise<void> {
    // Both crons fire at 03:00; only the 15-minute one retries, so nothing is sent twice.
    if (controller.cron === CRON_SYNC) {
      if (env.CATALOG_CSV_URL) {
        const report = await syncCatalog(env);
        console.log(`catalog sync: ok=${report.ok} total=${report.total} active=${report.active} errors=${report.errors.length}`);
      }
      return;
    }
    await retryPending(await withAdminChatOverride(env));
  },
} satisfies ExportedHandler<Env>;

async function telegramWebhook(request: Request, env: Env, exec: ExecutionContext): Promise<Response> {
  if (request.method !== 'POST') return new Response('Method not allowed', { status: 405 });
  const secret = request.headers.get('X-Telegram-Bot-Api-Secret-Token') ?? '';
  if (!env.WEBHOOK_SECRET || !safeEqual(secret, env.WEBHOOK_SECRET)) return new Response('Unauthorized', { status: 401 });
  let update: TgUpdate;
  try {
    update = await request.json();
  } catch {
    return new Response('ok');
  }
  if (!Number.isSafeInteger(update.update_id)) return new Response('ok');
  // Nothing has happened yet if this first write fails: ask Telegram to deliver again.
  let fresh: boolean;
  try {
    fresh = await db.markUpdate(env.DB, update.update_id);
    env = await withAdminChatOverride(env);
  } catch (err) {
    console.error(`update ${update.update_id}: ${err instanceof Error ? err.message : err}`);
    return new Response('retry', { status: 503 });
  }
  if (!fresh) return new Response('ok');
  try {
    await handleUpdate(env, update, exec);
  } catch (err) {
    // Answer 200 anyway: a retried update would hit the same error again.
    console.error(`update ${update.update_id}: ${err instanceof Error ? err.stack ?? err.message : err}`);
  }
  return new Response('ok');
}

async function health(env: Env): Promise<Response> {
  const row = await env.DB.prepare(
    `SELECT (SELECT COUNT(*) FROM products WHERE active = 1) AS products,
            (SELECT COUNT(*) FROM orders WHERE admin_message_id IS NULL) AS unsent_cards`,
  ).first<{ products: number; unsent_cards: number }>();
  const moved = await db.getMeta(env.DB, ADMIN_CHAT_OVERRIDE);
  return json({
    ok: true,
    products: row?.products ?? 0,
    // Orders the operators have not seen yet: should be 0.
    unsent_cards: row?.unsent_cards ?? 0,
    catalog_synced_at: await db.getMeta(env.DB, 'catalog_synced_at'),
    cron_at: await db.getMeta(env.DB, 'cron_at'),
    ...(moved ? { admin_chat_moved: `${moved.replace('>', ' -> ')}: update ADMIN_CHAT_ID` } : {}),
  });
}

async function api(request: Request, env: Env, url: URL, path: string): Promise<Response> {
  if (!bearerOk(request, env.ADMIN_TOKEN)) return json({ ok: false, error: 'unauthorized' }, 401);

  if (request.method === 'GET' && path === '/api/orders') {
    const sinceId = Math.max(0, Number.parseInt(url.searchParams.get('since_id') ?? '0', 10) || 0);
    const limit = Math.min(500, Math.max(1, Number.parseInt(url.searchParams.get('limit') ?? '100', 10) || 100));
    const orders = await db.listOrdersSince(env.DB, sinceId, limit);
    if (url.searchParams.get('format') === 'csv') {
      const rows = orders.map(sheetRow);
      const header = ['id', 'created', 'status', 'customer', 'phone', 'region', 'address', 'note', 'items', 'total', 'lang', 'telegram', 'chat_id', 'updated'];
      const cell = (v: unknown) => {
        let s = String(v ?? '');
        if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`; // keep spreadsheets from running it as a formula
        return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
      };
      const csv = [header.join(','), ...rows.map((r) => header.map((h) => cell(r[h])).join(','))].join('\r\n');
      return new Response(`﻿${csv}\r\n`, { headers: { 'Content-Type': 'text/csv; charset=utf-8' } });
    }
    return json({ ok: true, orders });
  }

  if (request.method === 'POST' && path === '/api/sync') {
    const report = await syncCatalog(env);
    return json(report, report.ok ? 200 : 422);
  }

  if (request.method === 'POST' && path === '/api/setup') return setup(await withAdminChatOverride(env), url);

  return json({ ok: false, error: 'not found' }, 404);
}

/** Points the Telegram webhook at this Worker and registers the command menu. */
async function setup(env: Env, url: URL): Promise<Response> {
  if (!/^[A-Za-z0-9_-]{16,256}$/.test(env.WEBHOOK_SECRET ?? '')) {
    return json({ ok: false, error: 'WEBHOOK_SECRET must be 16-256 characters of A-Z, a-z, 0-9, _ or -' }, 400);
  }
  const webhook = `${url.origin}/telegram`;
  const me = await tg<{ username: string }>(env, 'getMe', {});
  await tg(env, 'setWebhook', {
    url: webhook,
    secret_token: env.WEBHOOK_SECRET,
    allowed_updates: ['message', 'callback_query'],
    max_connections: 20,
  });
  const customer = {
    uz: [
      { command: 'start', description: 'Boshlash' },
      { command: 'catalog', description: 'Katalog' },
      { command: 'cart', description: 'Savat' },
      { command: 'orders', description: 'Buyurtmalarim' },
      { command: 'contact', description: 'Aloqa' },
      { command: 'lang', description: 'Til / Язык' },
    ],
    ru: [
      { command: 'start', description: 'Начать' },
      { command: 'catalog', description: 'Каталог' },
      { command: 'cart', description: 'Корзина' },
      { command: 'orders', description: 'Мои заказы' },
      { command: 'contact', description: 'Контакты' },
      { command: 'lang', description: 'Til / Язык' },
    ],
  };
  const privateChats = { type: 'all_private_chats' };
  await tg(env, 'setMyCommands', { scope: privateChats, commands: customer.uz });
  await tg(env, 'setMyCommands', { scope: privateChats, language_code: 'ru', commands: customer.ru });
  // Groups get no customer commands: they do nothing there.
  await tg(env, 'setMyCommands', { commands: [] });
  const warnings: string[] = [];
  const adminChat = adminChatId(env);
  if (!adminChat) {
    warnings.push('ADMIN_CHAT_ID is empty: orders will not reach anyone');
  } else {
    try {
      const chat = await tg<{ type: string; title?: string }>(env, 'getChat', { chat_id: adminChat });
      if (chat.type === 'group') {
        warnings.push(
          'ADMIN_CHAT_ID is a basic group. Telegram gives it a new id when it becomes a supergroup; the bot follows ' +
            'the move, but convert it now (group settings > Chat history for new members: Visible) and update ADMIN_CHAT_ID',
        );
      }
      if (chat.type !== 'private') {
        await tg(env, 'setMyCommands', {
          scope: { type: 'chat', chat_id: adminChat },
          commands: [
            { command: 'orders', description: 'Ochiq buyurtmalar' },
            { command: 'order', description: 'Buyurtma kartasi: /order 12' },
            { command: 'stats', description: 'Statistika' },
            { command: 'sync', description: 'Katalogni yangilash' },
            { command: 'help', description: 'Operator buyruqlari' },
            { command: 'id', description: 'Chat ID' },
          ],
        });
      }
    } catch (err) {
      warnings.push(`ADMIN_CHAT_ID ${adminChat}: ${err instanceof TgError ? err.description : err} (is the bot in that chat?)`);
    }
  }
  if (env.BOT_USERNAME && env.BOT_USERNAME.replace(/^@/, '') !== me.username) {
    warnings.push(`BOT_USERNAME is "${env.BOT_USERNAME}" but the token belongs to @${me.username}`);
  }
  return json({ ok: true, bot: `@${me.username}`, webhook, warnings });
}

/**
 * Re-sends order cards that never reached the operators and rows that never reached the sheet.
 * Kept small: a free-plan invocation may make at most 50 subrequests/D1 queries.
 */
export async function retryPending(env: Env): Promise<void> {
  const cutoff = new Date(Date.now() - 2 * 60_000).toISOString();
  for (const order of await db.listUnnotifiedOrders(env.DB, cutoff, 5)) {
    try {
      await notifyNewOrder(env, order);
    } catch (err) {
      console.error(`retry notify #${order.id}: ${err instanceof Error ? err.message : err}`);
    }
  }
  if (env.SHEETS_WEBHOOK_URL) {
    for (const order of await db.listUnsyncedOrders(env.DB, 10)) await pushOrder(env, order);
  }
  await db.pruneOld(env.DB);
  await db.setMeta(env.DB, 'cron_at', nowIso());
}
