// Regression tests for the issues found in the independent review.
import { createExecutionContext, env, waitOnExecutionContext } from 'cloudflare:test';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { adminOrderView } from '../src/render';
import { getMeta, getSession, type Order } from '../src/db';
import worker from '../src/index';
import { visibleLength } from '../src/tg';
import {
  ADMIN_CHAT,
  SECRET,
  buttons,
  callbackUpdate,
  deliver,
  messageUpdate,
  mockNetwork,
  onboard,
  textUpdate,
  okButton,
  type Net,
} from './helpers';

let net: Net;
beforeEach(() => {
  net = mockNetwork();
});
afterEach(() => {
  vi.restoreAllMocks();
});

const toAdmin = () => net.calls.filter((c) => String(c.params.chat_id) === String(ADMIN_CHAT));
const orderCount = async (chat: number) =>
  (await env.DB.prepare('SELECT COUNT(*) AS n FROM orders WHERE chat_id = ?').bind(chat).first<{ n: number }>())!.n;

async function toSummary(chat: number): Promise<void> {
  await deliver(callbackUpdate(chat, 'a:bistrepen:2'));
  await deliver(callbackUpdate(chat, 'co'));
  const s = await getSession(env.DB, chat);
  if (s.step === 'saved') {
    await deliver(callbackUpdate(chat, 'sv:y'));
  } else {
    await deliver(textUpdate(chat, 'Ali fermasi'));
    await deliver(textUpdate(chat, '+998901234567'));
    await deliver(callbackUpdate(chat, 'rg:and'));
    await deliver(textUpdate(chat, 'Asaka tumani'));
  }
  await deliver(callbackUpdate(chat, 'sk'));
}

describe('steps never swallow receipts and questions', () => {
  it('a photo sent mid-checkout goes to the operators and the checkout continues', async () => {
    const chat = 3001;
    await onboard(chat);
    await deliver(callbackUpdate(chat, 'a:kefen:1'));
    await deliver(callbackUpdate(chat, 'co'));
    await deliver(messageUpdate(chat, { photo: [{ file_id: 'p1', width: 9, height: 9 }] }));
    expect(net.of('copyMessage')).toHaveLength(1);
    expect((await getSession(env.DB, chat)).step).toBe('name');
  });

  it('an abandoned checkout expires after 30 minutes', async () => {
    const chat = 3002;
    await onboard(chat);
    await deliver(callbackUpdate(chat, 'a:kefen:1'));
    await deliver(callbackUpdate(chat, 'co'));
    const old = new Date(Date.now() - 31 * 60_000).toISOString();
    await env.DB.prepare('UPDATE sessions SET updated_at = ? WHERE chat_id = ?').bind(old, chat).run();
    net.clear();
    await deliver(textUpdate(chat, 'Buyurtmam qachon keladi?'));
    expect(toAdmin().some((c) => String(c.params.text).includes('Buyurtmam qachon keladi?'))).toBe(true);
    const s = await getSession(env.DB, chat);
    expect(s.step).toBeNull();
    expect(s.draft.name).toBeUndefined();
  });

  it('a question typed at the summary reaches the operators and the buttons stay', async () => {
    const chat = 3003;
    await onboard(chat);
    await toSummary(chat);
    net.clear();
    await deliver(textUpdate(chat, 'Yetkazib berish qancha?'));
    expect(toAdmin()).toHaveLength(1);
    expect(net.texts(chat).some((t) => t.includes('tugmalardan'))).toBe(true);
    expect(buttons(net.lastTo(chat))[0]).toMatch(/^ok:/);
  });

  it('a voice note is a question, not a receipt', async () => {
    const chat = 3004;
    await onboard(chat);
    await toSummary(chat);
    await deliver(callbackUpdate(chat, okButton(net, chat)));
    net.clear();
    await deliver(messageUpdate(chat, { voice: { file_id: 'v1' } }));
    expect(toAdmin()[0]!.params.text).toContain('Mijoz xabari');
    expect(net.lastTo(chat)!.params.text).not.toContain('Rasm');
  });
});

describe('quantities', () => {
  it('a number typed under a product card goes into the cart', async () => {
    const chat = 3101;
    await onboard(chat, 'ru');
    await deliver(callbackUpdate(chat, 'p:kefen'));
    await deliver(textUpdate(chat, '15'));
    expect((await getSession(env.DB, chat)).cart).toEqual([{ id: 'kefen', qty: 15 }]);
    expect(toAdmin()).toHaveLength(0);
  });

  it('other text under a product card is a question for the operators', async () => {
    const chat = 3102;
    await onboard(chat);
    await deliver(callbackUpdate(chat, 'p:kefen'));
    await deliver(textUpdate(chat, 'Bu sigirga boʻladimi?'));
    expect((await getSession(env.DB, chat)).cart).toEqual([]);
    expect(toAdmin()).toHaveLength(1);
  });

  it('accepts "10 ta" and "5 шт"', async () => {
    const chat = 3103;
    await onboard(chat);
    await deliver(callbackUpdate(chat, 'q:kefen'));
    await deliver(textUpdate(chat, '10 ta'));
    await deliver(callbackUpdate(chat, 'q:butofan'));
    await deliver(textUpdate(chat, '5 шт'));
    expect((await getSession(env.DB, chat)).cart).toEqual([
      { id: 'kefen', qty: 10 },
      { id: 'butofan', qty: 5 },
    ]);
  });

  it('says how much was added and the new line total', async () => {
    const chat = 3104;
    await onboard(chat);
    await deliver(callbackUpdate(chat, 'a:kefen:5'));
    await deliver(callbackUpdate(chat, 'a:kefen:10'));
    const text = net.lastTo(chat)!.params.text as string;
    expect(text).toContain('× 10');
    expect(text).toContain('Savatda jami: 15');
  });

  it('uses Russian plural forms', async () => {
    const chat = 3105;
    await onboard(chat, 'ru');
    await deliver(callbackUpdate(chat, 'a:bistrepen:1'));
    await deliver(callbackUpdate(chat, 'a:kefen:2'));
    await deliver(callbackUpdate(chat, 'a:butofan:15'));
    await deliver(callbackUpdate(chat, 'cart'));
    const text = net.of('editMessageText').at(-1)!.params.text as string;
    expect(text).toContain('Бистрепен — 1 флакон');
    expect(text).toContain('Кефен — 2 флакона');
    expect(text).toContain('Бутофан — 15 флаконов');
  });
});

describe('checkout safety', () => {
  it('re-shows the summary when a price changed after it was shown', async () => {
    const chat = 3201;
    await onboard(chat);
    await toSummary(chat);
    await env.DB.prepare("UPDATE products SET price = 99000 WHERE id = 'bistrepen'").run();
    await deliver(callbackUpdate(chat, okButton(net, chat)));
    expect(await orderCount(chat)).toBe(0);
    const summary = net.lastTo(chat)!.params.text as string;
    expect(summary).toContain('Narx yoki savat oʻzgardi');
    expect(summary).toContain('198 000 soʻm');
    await deliver(callbackUpdate(chat, okButton(net, chat)));
    expect(await orderCount(chat)).toBe(1);
    await env.DB.prepare("UPDATE products SET price = NULL WHERE id = 'bistrepen'").run();
  });

  it('limits orders per chat per day', async () => {
    const chat = 3202;
    await onboard(chat);
    for (let i = 0; i < 6; i++) {
      await toSummary(chat);
      await deliver(callbackUpdate(chat, okButton(net, chat)));
    }
    expect(await orderCount(chat)).toBe(5);
    expect(net.lastTo(chat)!.params.text).toContain('+998 90 000 00 00');
  });

  it('leaving checkout from the menu says so and restores the menu', async () => {
    const chat = 3203;
    await onboard(chat);
    await deliver(callbackUpdate(chat, 'a:kefen:1'));
    await deliver(callbackUpdate(chat, 'co'));
    await deliver(textUpdate(chat, 'Vali'));
    const phonePrompt = net.lastTo(chat)!;
    expect(phonePrompt.params.reply_markup.keyboard[0][0].request_contact).toBe(true);
    expect(phonePrompt.params.reply_markup.is_persistent).toBe(true);
    expect(phonePrompt.params.reply_markup.keyboard.flat().map((b: any) => b.text)).toContain('🧺 Savat');
    net.clear();
    await deliver(textUpdate(chat, '🛒 Katalog'));
    const notice = net.of('sendMessage')[0]!;
    expect(notice.params.text).toContain('toʻxtatildi');
    expect(notice.params.reply_markup.keyboard[0][0].text).toBe('🛒 Katalog');
  });

  it('a stray contact outside the phone step only brings back the menu', async () => {
    const chat = 3204;
    await onboard(chat);
    net.clear();
    await deliver(messageUpdate(chat, { contact: { phone_number: '998901112233', first_name: 'A', user_id: chat } }));
    expect(toAdmin()).toHaveLength(0);
    expect(net.lastTo(chat)!.params.reply_markup.keyboard).toBeDefined();
  });
});

describe('operators chat', () => {
  async function question(chat: number): Promise<number> {
    await onboard(chat);
    await deliver(textUpdate(chat, 'Savol bor'));
    const row = await env.DB.prepare(`SELECT admin_message_id FROM relay WHERE chat_id = ? AND kind = 'in'`)
      .bind(chat)
      .first<{ admin_message_id: number }>();
    return row!.admin_message_id;
  }
  const reply = (text: string, to: number, extra: Record<string, unknown> = {}, from = 777) =>
    messageUpdate(ADMIN_CHAT, { text, reply_to_message: { message_id: to, chat: { id: ADMIN_CHAT, type: 'supergroup' }, date: 0 }, ...extra }, from);

  it('relays only links made in the current operators chat', async () => {
    const chat = 3301;
    await onboard(chat);
    await env.DB.prepare(
      `INSERT INTO relay (admin_chat_id, admin_message_id, chat_id, order_id, kind, created_at) VALUES ('-100999', 4242, ?, NULL, 'in', ?)`,
    )
      .bind(chat, new Date().toISOString())
      .run();
    net.clear();
    await deliver(reply('ichki gap', 4242));
    expect(net.texts(chat)).toHaveLength(0);
  });

  it('a command sent as a reply runs as a command and is not relayed', async () => {
    const chat = 3302;
    const msgId = await question(chat);
    net.clear();
    await deliver(reply('/orders', msgId));
    expect(net.texts(chat)).toHaveLength(0);
    expect(net.texts(ADMIN_CHAT).some((t) => t.includes('Ochiq buyurtmalar') || t.includes('Ochiq buyurtma yoʻq'))).toBe(true);
  });

  it('relays replies from anonymous group admins', async () => {
    const chat = 3303;
    const msgId = await question(chat);
    net.clear();
    await deliver({
      update_id: Date.now(),
      message: {
        message_id: 99,
        from: { id: 1087968824, is_bot: true, first_name: 'Group', username: 'GroupAnonymousBot' },
        sender_chat: { id: ADMIN_CHAT, type: 'supergroup', title: 'VETCO' },
        chat: { id: ADMIN_CHAT, type: 'supergroup' },
        date: 0,
        text: 'Ertaga yetkazamiz',
        reply_to_message: { message_id: msgId, chat: { id: ADMIN_CHAT, type: 'supergroup' }, date: 0 },
      },
    });
    expect(net.lastTo(chat)!.params.text).toContain('Ertaga yetkazamiz');
  });

  it('staff commands with customer data never run in other groups', async () => {
    net.clear();
    await deliver(messageUpdate(-100999, { text: '/orders' }, 500));
    expect(net.calls.filter((c) => c.method === 'sendMessage')).toHaveLength(0);
  });

  it('an album gets one header and one answer, and counts once toward the limit', async () => {
    const chat = 3304;
    await onboard(chat);
    net.clear();
    for (let i = 0; i < 3; i++) {
      await deliver(messageUpdate(chat, { media_group_id: 'alb1', photo: [{ file_id: `f${i}`, width: 9, height: 9 }] }));
    }
    expect(net.of('copyMessage')).toHaveLength(3);
    expect(toAdmin().filter((c) => c.method === 'sendMessage')).toHaveLength(1);
    expect(net.texts(chat)).toHaveLength(1);
    const n = await env.DB.prepare(`SELECT COUNT(*) AS n FROM relay WHERE chat_id = ? AND kind = 'in'`).bind(chat).first<{ n: number }>();
    expect(n!.n).toBe(1);
  });

  it('warns the operators when the customer cannot be told about a status change', async () => {
    vi.restoreAllMocks();
    const chat = 3305;
    net = mockNetwork({
      fail: (method, p) =>
        method === 'sendMessage' && p.chat_id === chat && String(p.text).includes('Tasdiqlandi') ? 'Forbidden: bot was blocked by the user' : undefined,
    });
    await onboard(chat);
    await toSummary(chat);
    await deliver(callbackUpdate(chat, okButton(net, chat)));
    const id = (await env.DB.prepare('SELECT id FROM orders WHERE chat_id = ?').bind(chat).first<{ id: number }>())!.id;
    await deliver(callbackUpdate(ADMIN_CHAT, `ad:${id}:confirmed`, 777));
    const warning = toAdmin().find((c) => String(c.params.text).includes('mijozga xabar yetmadi'));
    expect(warning?.params.text).toContain('+998901234567');
    expect(warning?.params.reply_parameters).toBeDefined();
  });

  it('follows the operators group when Telegram moves it to a supergroup', async () => {
    vi.restoreAllMocks();
    const NEW = -1009998887;
    net = mockNetwork({
      fail: (method, p) =>
        String(p.chat_id) === String(ADMIN_CHAT) && (method === 'sendMessage' || method === 'copyMessage')
          ? { description: 'Bad Request: group chat was upgraded to a supergroup chat', parameters: { migrate_to_chat_id: NEW } }
          : undefined,
    });
    const chat = 3306;
    await onboard(chat);
    await toSummary(chat);
    await deliver(callbackUpdate(chat, okButton(net, chat)));
    expect(net.of('sendMessage').some((c) => c.params.chat_id === String(NEW) && String(c.params.text).includes('Yangi buyurtma'))).toBe(true);
    expect(await getMeta(env.DB, 'admin_chat_id')).toBe(`-100777>${NEW}`);
    // Later updates use the new chat right away, and its members are staff.
    net.clear();
    await deliver(textUpdate(chat, 'Yana savol'));
    expect(net.of('sendMessage').some((c) => c.params.chat_id === String(NEW))).toBe(true);
    await deliver(messageUpdate(NEW, { text: '/stats' }, 12345));
    expect(net.of('sendMessage').some((c) => c.params.chat_id === NEW && String(c.params.text).includes('Bugun'))).toBe(true);
    await env.DB.prepare("DELETE FROM meta WHERE key = 'admin_chat_id'").run();
  });

  it('records the move from the service message too', async () => {
    await deliver(messageUpdate(ADMIN_CHAT, { migrate_to_chat_id: -1001112223 }, 777));
    expect(await getMeta(env.DB, 'admin_chat_id')).toBe('-100777>-1001112223');
    await env.DB.prepare("DELETE FROM meta WHERE key = 'admin_chat_id'").run();
  });

  it('escapes the first /sync error', async () => {
    vi.restoreAllMocks();
    net = mockNetwork({ csv: 'id,name,category\n<new>,Foo,vitamin' });
    await deliver(messageUpdate(ADMIN_CHAT, { text: '/sync' }, 777));
    const text = net.lastTo(ADMIN_CHAT)!.params.text as string;
    expect(text).toContain('&lt;new&gt;');
    expect(text).not.toContain('<new>');
  });
});

describe('webhook and cards', () => {
  it('asks Telegram to retry when the first database write fails', async () => {
    const broken = { ...env, DB: { prepare: () => { throw new Error('D1 DB is overloaded'); } } } as unknown as typeof env;
    const ctx = createExecutionContext();
    const res = await worker.fetch(
      new Request('https://bot.test/telegram', {
        method: 'POST',
        headers: { 'X-Telegram-Bot-Api-Secret-Token': SECRET },
        body: JSON.stringify(textUpdate(3401, '/start')),
      }),
      broken,
      ctx,
    );
    await waitOnExecutionContext(ctx);
    expect(res.status).toBe(503);
  });

  it('keeps a huge order card to one editable message', () => {
    const items = Array.from({ length: 30 }, (_, i) => ({
      id: `p${i}`,
      name: `${'Juda uzun preparat nomi '.repeat(3)}${i}`.slice(0, 80),
      name_ru: null,
      qty: 9999,
      price: 1_250_000_000,
      unit_uz: 'flakon',
      unit_ru: 'флакон',
    }));
    const order = {
      id: 77,
      chat_id: 1,
      username: 'u',
      lang: 'uz',
      customer_name: 'N'.repeat(80),
      phone: '+998901234567',
      region: 'tsh',
      address: 'A'.repeat(300),
      note: 'B'.repeat(500),
      items,
      total: 1,
      status: 'new',
      admin_message_id: null,
      sheets_synced: 0,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    } as Order;
    const view = adminOrderView(order, 'Menejer Ism Familiya, 19.10.2026 14:05');
    expect(view.truncated).toBe(true);
    expect(visibleLength(view.text)).toBeLessThanOrEqual(4000);
    expect(view.text).toContain('/order 77');
    expect(adminOrderView({ ...order, status: 'delivered' }).text).toContain('📦 <b>Buyurtma #77</b>');
  });

  it('shows the withdrawal-period warning on every card', async () => {
    await onboard(3402);
    await deliver(callbackUpdate(3402, 'p:kefen'));
    expect(net.lastTo(3402)!.params.text).toContain('kutish muddatiga');
  });
});

describe('second review round', () => {
  it('an old Confirm button never places a summary the customer did not see', async () => {
    const chat = 3501;
    await onboard(chat);
    await toSummary(chat);
    const oldOk = okButton(net, chat);
    await env.DB.prepare("UPDATE products SET price = 99000 WHERE id = 'bistrepen'").run();
    await deliver(textUpdate(chat, 'ha')); // typed instead of tapping: the summary is shown again
    expect(net.lastTo(chat)!.params.text).toContain('Narx yoki savat oʻzgardi');
    await deliver(callbackUpdate(chat, oldOk));
    expect(await orderCount(chat)).toBe(0);
    await deliver(callbackUpdate(chat, okButton(net, chat)));
    expect(await orderCount(chat)).toBe(1);
    await env.DB.prepare("UPDATE products SET price = NULL WHERE id = 'bistrepen'").run();
  });

  it("a number answering the operator is not taken for the product card's quantity", async () => {
    const chat = 3502;
    await onboard(chat);
    await deliver(callbackUpdate(chat, 'p:kefen'));
    await deliver(messageUpdate(chat, { photo: [{ file_id: 'x', width: 9, height: 9 }] }));
    const row = await env.DB.prepare(`SELECT admin_message_id FROM relay WHERE chat_id = ? AND kind = 'in'`).bind(chat).first<{ admin_message_id: number }>();
    await deliver(
      messageUpdate(ADMIN_CHAT, { text: 'Necha bosh mol bor?', reply_to_message: { message_id: row!.admin_message_id, chat: { id: ADMIN_CHAT, type: 'supergroup' }, date: 0 } }, 777),
    );
    net.clear();
    await deliver(textUpdate(chat, '40'));
    expect((await getSession(env.DB, chat)).cart).toEqual([]);
    expect(toAdmin().some((c) => String(c.params.text).includes('40'))).toBe(true);
  });

  it('a reply or an unknown command under a product card is not a quantity', async () => {
    const chat = 3503;
    await onboard(chat);
    await deliver(callbackUpdate(chat, 'p:kefen'));
    await deliver(textUpdate(chat, '12', { reply_to_message: { message_id: 1, chat: { id: chat, type: 'private' }, date: 0 } }));
    expect((await getSession(env.DB, chat)).cart).toEqual([]);
    await deliver(callbackUpdate(chat, 'p:kefen'));
    net.clear();
    await deliver(textUpdate(chat, '/menu'));
    expect(toAdmin()).toHaveLength(0);
    expect(net.lastTo(chat)!.params.text).toContain('VETCO');
  });

  it('ignores service messages such as a pin', async () => {
    const chat = 3504;
    await onboard(chat);
    net.clear();
    await deliver(messageUpdate(chat, { pinned_message: { message_id: 1, chat: { id: chat, type: 'private' }, date: 0 } }));
    expect(net.calls.filter((c) => c.method !== 'answerCallbackQuery')).toHaveLength(0);
  });

  it('refuses an album over the daily limit once, not per photo', async () => {
    const chat = 3505;
    await onboard(chat);
    const now = new Date().toISOString();
    for (let i = 0; i < 30; i++) {
      await env.DB.prepare(`INSERT INTO relay (admin_chat_id, admin_message_id, chat_id, order_id, kind, created_at) VALUES ('-100777', ?, ?, NULL, 'in', ?)`)
        .bind(900000 + chat * 100 + i, chat, now)
        .run();
    }
    net.clear();
    for (let i = 0; i < 4; i++) {
      await deliver(messageUpdate(chat, { media_group_id: 'big', photo: [{ file_id: `g${i}`, width: 9, height: 9 }] }));
    }
    expect(net.texts(chat)).toHaveLength(1);
    expect(toAdmin()).toHaveLength(0);
  });

  it('Cancel after only viewing a product says nothing about a checkout', async () => {
    const chat = 3506;
    await onboard(chat);
    await deliver(callbackUpdate(chat, 'p:kefen'));
    net.clear();
    await deliver(callbackUpdate(chat, 'x'));
    expect(net.texts(chat).some((t) => t.includes('toʻxtatildi'))).toBe(false);
  });

  it('a failed read before the dedup insert lets Telegram redeliver the update', async () => {
    const realPrepare = env.DB.prepare.bind(env.DB);
    const flaky = {
      ...env,
      DB: { ...env.DB, prepare: (sql: string) => (sql.includes('FROM meta') ? (() => { throw new Error('Network connection lost'); })() : realPrepare(sql)) },
    } as unknown as typeof env;
    const update = textUpdate(3507, '/start');
    const send = async (e: typeof env) => {
      const ctx = createExecutionContext();
      const res = await worker.fetch(
        new Request('https://bot.test/telegram', { method: 'POST', headers: { 'X-Telegram-Bot-Api-Secret-Token': SECRET }, body: JSON.stringify(update) }),
        e,
        ctx,
      );
      await waitOnExecutionContext(ctx);
      return res.status;
    };
    expect(await send(flaky)).toBe(503);
    expect(await send(env)).toBe(200);
    expect(net.texts(3507).length).toBeGreaterThan(0);
  });

  it('a second group move is recorded against the configured chat, and stale moves are not reported', async () => {
    await env.DB.prepare(`INSERT OR REPLACE INTO meta (key, value) VALUES ('admin_chat_id', '-100111>-100222')`).run();
    const health = (await (await worker.fetch(new Request('https://bot.test/health'), env, createExecutionContext())).json()) as Record<string, unknown>;
    expect(health.admin_chat_moved).toBeUndefined();
    await deliver(messageUpdate(ADMIN_CHAT, { migrate_to_chat_id: -100444 }, 777));
    expect(await getMeta(env.DB, 'admin_chat_id')).toBe('-100777>-100444');
    net.clear();
    await deliver(messageUpdate(-100444, { text: '/stats' }, 12345));
    expect(net.texts(-100444).some((t) => t.includes('Bugun'))).toBe(true);
    await env.DB.prepare("DELETE FROM meta WHERE key = 'admin_chat_id'").run();
  });

  it('budgets the order card per item even when a name has a line break', () => {
    const items = Array.from({ length: 40 }, (_, i) => ({
      id: `p${i}`,
      name: `Nom ${i}\n${'x'.repeat(60)}`,
      name_ru: null,
      qty: 1,
      price: null,
      unit_uz: 'flakon',
      unit_ru: 'флакон',
    }));
    const now = new Date().toISOString();
    const order = { id: 88, chat_id: 1, username: null, lang: 'uz', customer_name: 'A', phone: '+998900000000', region: 'tsh', address: 'B', note: null, items, total: null, status: 'new', admin_message_id: null, sheets_synced: 0, created_at: now, updated_at: now } as Order;
    const view = adminOrderView(order);
    const shown = (view.text.match(/^\d+\. Nom/gm) ?? []).length;
    expect(view.truncated).toBe(shown < 40);
    if (view.truncated) expect(view.text).toContain(`yana ${40 - shown} ta preparat`);
  });
});

describe('third review round', () => {
  it('a number sent as a reply to the product card goes into the cart', async () => {
    const chat = 3601;
    await onboard(chat);
    await deliver(callbackUpdate(chat, 'p:kefen'));
    const card = net.lastTo(chat)!;
    net.clear();
    await deliver(
      textUpdate(chat, '10', {
        reply_to_message: { message_id: 4, chat: { id: chat, type: 'private' }, date: 0, text: card.params.text, reply_markup: card.params.reply_markup },
      }),
    );
    expect((await getSession(env.DB, chat)).cart).toEqual([{ id: 'kefen', qty: 10 }]);
    expect(toAdmin()).toHaveLength(0);
  });

  it('a failed album header is posted by the next photo', async () => {
    vi.restoreAllMocks();
    let failed = false;
    net = mockNetwork({
      fail: (method, p) => {
        if (!failed && method === 'sendMessage' && String(p.chat_id) === String(ADMIN_CHAT)) {
          failed = true;
          return 'Too Many Requests: retry after 1';
        }
        return undefined;
      },
    });
    const chat = 3602;
    await onboard(chat);
    for (let i = 0; i < 3; i++) {
      await deliver(messageUpdate(chat, { media_group_id: 'albF', photo: [{ file_id: `h${i}`, width: 9, height: 9 }] }));
    }
    const headers = toAdmin().filter((c) => c.method === 'sendMessage' && String(c.params.text).includes('Mijoz xabari'));
    expect(headers).toHaveLength(2); // the failed attempt, then the one that got through
    const inbound = await env.DB.prepare(`SELECT COUNT(*) AS n FROM relay WHERE chat_id = ? AND kind = 'in'`).bind(chat).first<{ n: number }>();
    expect(inbound!.n).toBe(1);
  });

  it("an operator reply clears only the customer's soft step, never the cart", async () => {
    const chat = 3603;
    await onboard(chat);
    await deliver(callbackUpdate(chat, 'a:butofan:3'));
    await deliver(textUpdate(chat, 'Savol'));
    await deliver(callbackUpdate(chat, 'p:kefen'));
    const row = await env.DB.prepare(`SELECT admin_message_id FROM relay WHERE chat_id = ? AND kind = 'in'`).bind(chat).first<{ admin_message_id: number }>();
    await deliver(
      messageUpdate(ADMIN_CHAT, { text: 'Javob', reply_to_message: { message_id: row!.admin_message_id, chat: { id: ADMIN_CHAT, type: 'supergroup' }, date: 0 } }, 777),
    );
    const s = await getSession(env.DB, chat);
    expect(s.step).toBeNull();
    expect(s.cart).toEqual([{ id: 'butofan', qty: 3 }]);
  });

  it('forwards a story and explains content that cannot be passed on', async () => {
    const chat = 3604;
    await onboard(chat);
    net.clear();
    await deliver(messageUpdate(chat, { story: { chat: { id: -100555, type: 'channel' }, id: 7 } }));
    expect(net.of('copyMessage')).toHaveLength(1);
    net.clear();
    await deliver(messageUpdate(chat, { paid_media: { star_count: 5, paid_media: [] } }));
    expect(toAdmin()).toHaveLength(0);
    expect(net.lastTo(chat)!.params.text).toContain('operatorga yubora olmayman');
  });
});
