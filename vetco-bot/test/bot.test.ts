import { env } from 'cloudflare:test';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getOrder, getSession } from '../src/db';
import {
  ADMIN_CHAT,
  SECRET,
  buttons,
  callbackUpdate,
  call,
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

async function ordersOf(chatId: number) {
  const { results } = await env.DB.prepare('SELECT id, status, total, note, items, admin_message_id FROM orders WHERE chat_id = ? ORDER BY id')
    .bind(chatId)
    .all<{ id: number; status: string; total: number | null; note: string | null; items: string; admin_message_id: number | null }>();
  return results;
}

/** Cart with two products, then the full checkout up to the confirmation summary. */
async function checkoutToConfirm(chatId: number): Promise<void> {
  await deliver(callbackUpdate(chatId, 'a:bistrepen:2'));
  await deliver(callbackUpdate(chatId, 'a:kefen:1'));
  await deliver(callbackUpdate(chatId, 'co'));
  await deliver(textUpdate(chatId, 'Ali fermasi'));
  await deliver(textUpdate(chatId, '90 123 45 67'));
  await deliver(callbackUpdate(chatId, 'rg:sam'));
  await deliver(textUpdate(chatId, 'Urgut tumani, Qorabogʻ qishlogʻi'));
  await deliver(callbackUpdate(chatId, 'sk'));
}

describe('webhook', () => {
  it('rejects a wrong secret and non-POST requests', async () => {
    expect((await deliver(textUpdate(1, '/start'), 'wrong')).status).toBe(401);
    expect((await call(new Request('https://bot.test/telegram'))).status).toBe(405);
    expect(net.calls).toHaveLength(0);
  });

  it('handles a repeated update only once', async () => {
    const update = textUpdate(2001, '/start');
    await deliver(update);
    await deliver(update);
    expect(net.of('sendMessage')).toHaveLength(1);
  });

  it('answers 200 even when Telegram calls fail', async () => {
    vi.restoreAllMocks();
    net = mockNetwork({ fail: () => 'Bad Request: chat not found' });
    const res = await deliver(textUpdate(2002, '/start'));
    expect(res.status).toBe(200);
  });
});

describe('language and menu', () => {
  it('asks for the language first and remembers it', async () => {
    await deliver(textUpdate(2101, '/start'));
    expect(buttons(net.lastTo(2101))).toEqual(['l:uz', 'l:ru']);
    await deliver(callbackUpdate(2101, 'l:ru'));
    expect((await getSession(env.DB, 2101)).lang).toBe('ru');
    const welcome = net.lastTo(2101)!;
    expect(welcome.params.text).toContain('Здравствуйте');
    expect(welcome.params.reply_markup.keyboard[0][0].text).toBe('🛒 Каталог');
    expect(net.of('answerCallbackQuery')).toHaveLength(1);
  });

  it('opens a product from a t.me deep link after the language is chosen', async () => {
    await deliver(textUpdate(2102, '/start p_kefen'));
    await deliver(callbackUpdate(2102, 'l:uz'));
    expect(net.texts(2102).some((t) => t.includes('<b>Kefen</b>'))).toBe(true);
  });

  it('shows active categories only, with their products', async () => {
    await onboard(2103);
    await deliver(textUpdate(2103, '🛒 Katalog'));
    const cats = buttons(net.lastTo(2103));
    expect(cats).toContain('c:antibiotik');
    expect(cats).toContain('c:vitamin');
    expect(cats).not.toContain('c:boshqa');
    await deliver(callbackUpdate(2103, 'c:vitamin'));
    const edit = net.of('editMessageText').at(-1)!;
    expect(buttons(edit)).toEqual(expect.arrayContaining(['p:butofan', 'p:fosbevit', 'cats']));
  });

  it('hides unverified doses and always shows the vet warning', async () => {
    await onboard(2104);
    await deliver(callbackUpdate(2104, 'p:bistrepen'));
    const card = net.lastTo(2104)!.params.text as string;
    expect(card).toContain('Brovafarma');
    expect(card).not.toContain('1 ml / 10 kg');
    expect(card).toContain('veterinar');
    expect(buttons(net.lastTo(2104))).toEqual(expect.arrayContaining(['a:bistrepen:1', 'q:bistrepen', 'c:antibiotik']));
  });

  it('shows the dose once it is marked verified', async () => {
    await env.DB.prepare("UPDATE products SET dose_verified = 1 WHERE id = 'fosbevit'").run();
    await onboard(2105);
    await deliver(callbackUpdate(2105, 'p:fosbevit'));
    expect(net.lastTo(2105)!.params.text).toContain('1 ml / 20 kg');
  });
});

describe('cart', () => {
  it('adds preset and typed quantities and merges lines', async () => {
    await onboard(2201);
    await deliver(callbackUpdate(2201, 'a:bistrepen:2'));
    await deliver(callbackUpdate(2201, 'a:bistrepen:5'));
    await deliver(callbackUpdate(2201, 'q:kefen'));
    await deliver(textUpdate(2201, 'ellik'));
    expect(net.lastTo(2201)!.params.text).toContain('1 dan 9999 gacha');
    await deliver(textUpdate(2201, '15'));
    expect((await getSession(env.DB, 2201)).cart).toEqual([
      { id: 'bistrepen', qty: 7 },
      { id: 'kefen', qty: 15 },
    ]);
    await deliver(textUpdate(2201, '🧺 Savat'));
    const cart = net.lastTo(2201)!;
    expect(cart.params.text).toContain('Bistrepen — 7 flakon');
    expect(cart.params.text).toContain('operator aytadi');
    expect(buttons(cart)).toEqual(expect.arrayContaining(['r:bistrepen', 'r:kefen', 'co', 'clr']));
    await deliver(callbackUpdate(2201, 'r:bistrepen'));
    expect((await getSession(env.DB, 2201)).cart).toEqual([{ id: 'kefen', qty: 15 }]);
  });

  it('rejects unknown products and bad quantities', async () => {
    await onboard(2202);
    await deliver(callbackUpdate(2202, 'a:azitronit:1')); // inactive
    await deliver(callbackUpdate(2202, 'a:bistrepen:0'));
    await deliver(callbackUpdate(2202, 'a:bistrepen:100000'));
    expect((await getSession(env.DB, 2202)).cart).toEqual([]);
  });

  it('shows prices and a total when every price is known', async () => {
    await env.DB.prepare("UPDATE products SET price = 45000 WHERE id IN ('butofan', 'fosbevit')").run();
    await onboard(2203);
    await deliver(callbackUpdate(2203, 'a:butofan:2'));
    await deliver(callbackUpdate(2203, 'a:fosbevit:1'));
    await deliver(callbackUpdate(2203, 'cart'));
    const text = net.of('editMessageText').at(-1)!.params.text as string;
    expect(text).toContain('Jami: 135 000 soʻm');
  });
});

describe('checkout', () => {
  it('creates exactly one order and notifies the operators', async () => {
    const chat = 2301;
    await onboard(chat);
    await checkoutToConfirm(chat);
    const summary = net.lastTo(chat)!;
    expect(summary.params.text).toContain('+998901234567');
    expect(summary.params.text).toContain('Samarqand viloyati');
    expect(buttons(summary)).toEqual([okButton(net, chat), 'x']);
    expect(okButton(net, chat)).toMatch(/^ok:[0-9a-z]+$/);

    await deliver(callbackUpdate(chat, okButton(net, chat)));
    await deliver(callbackUpdate(chat, okButton(net, chat))); // double tap
    const orders = await ordersOf(chat);
    expect(orders).toHaveLength(1);
    expect(orders[0]!.status).toBe('new');
    expect(orders[0]!.total).toBeNull();
    expect(JSON.parse(orders[0]!.items)).toHaveLength(2);
    expect(orders[0]!.admin_message_id).not.toBeNull();

    const card = net.of('sendMessage').find((c) => String(c.params.chat_id) === String(ADMIN_CHAT))!;
    expect(card.params.text).toContain(`Yangi buyurtma #${orders[0]!.id}`);
    expect(card.params.text).toContain('Ali fermasi');
    expect(buttons(card)).toEqual([`ad:${orders[0]!.id}:confirmed`, `ad:${orders[0]!.id}:cancelled`]);
    expect(net.texts(chat).some((t) => t.includes(`#${orders[0]!.id}`))).toBe(true);
    expect((await getSession(env.DB, chat)).cart).toEqual([]);
  });

  it('validates the phone number and keeps asking', async () => {
    const chat = 2302;
    await onboard(chat);
    await deliver(callbackUpdate(chat, 'a:kefen:1'));
    await deliver(callbackUpdate(chat, 'co'));
    await deliver(textUpdate(chat, 'Vali'));
    await deliver(textUpdate(chat, '12345'));
    expect(net.lastTo(chat)!.params.text).toContain('notoʻgʻri');
    expect((await getSession(env.DB, chat)).step).toBe('phone');
    await deliver(messageUpdate(chat, { contact: { phone_number: '998935554433', first_name: 'Vali', user_id: chat } }));
    const s = await getSession(env.DB, chat);
    expect(s.step).toBe('region');
    expect(s.draft.phone).toBe('+998935554433');
  });

  it('reuses saved details on the next order', async () => {
    const chat = 2303;
    await onboard(chat);
    await checkoutToConfirm(chat);
    await deliver(callbackUpdate(chat, okButton(net, chat)));
    await deliver(callbackUpdate(chat, 'a:fluneks:3'));
    await deliver(callbackUpdate(chat, 'co'));
    expect(buttons(net.lastTo(chat))).toEqual(['sv:y', 'sv:n', 'x']);
    await deliver(callbackUpdate(chat, 'sv:y'));
    await deliver(textUpdate(chat, '40 bosh buqa uchun'));
    await deliver(callbackUpdate(chat, okButton(net, chat)));
    const orders = await ordersOf(chat);
    expect(orders).toHaveLength(2);
    expect(orders[1]!.note).toBe('40 bosh buqa uchun');
  });

  it('cancel keeps the cart and leaves no order', async () => {
    const chat = 2304;
    await onboard(chat);
    await checkoutToConfirm(chat);
    await deliver(callbackUpdate(chat, 'x'));
    expect(await ordersOf(chat)).toHaveLength(0);
    const s = await getSession(env.DB, chat);
    expect(s.step).toBeNull();
    expect(s.cart).toHaveLength(2);
    await deliver(callbackUpdate(chat, okButton(net, chat)));
    expect(await ordersOf(chat)).toHaveLength(0);
  });

  it('menu buttons leave the checkout instead of being taken as answers', async () => {
    const chat = 2305;
    await onboard(chat);
    await deliver(callbackUpdate(chat, 'a:kefen:1'));
    await deliver(callbackUpdate(chat, 'co'));
    await deliver(textUpdate(chat, '🛒 Katalog'));
    const s = await getSession(env.DB, chat);
    expect(s.step).toBeNull();
    expect(s.draft.name).toBeUndefined();
  });

  it('escapes customer text in the operator card', async () => {
    const chat = 2306;
    await onboard(chat);
    await deliver(callbackUpdate(chat, 'a:kefen:1'));
    await deliver(callbackUpdate(chat, 'co'));
    await deliver(textUpdate(chat, '<b>Boss</b> & co'));
    await deliver(textUpdate(chat, '+998901112233'));
    await deliver(callbackUpdate(chat, 'rg:tsh'));
    await deliver(textUpdate(chat, '<a href="x">manzil</a>'));
    await deliver(callbackUpdate(chat, 'sk'));
    await deliver(callbackUpdate(chat, okButton(net, chat)));
    const card = net.of('sendMessage').find((c) => String(c.params.chat_id) === String(ADMIN_CHAT))!;
    expect(card.params.text).toContain('&lt;b&gt;Boss&lt;/b&gt; &amp; co');
    expect(card.params.text).toContain('&lt;a href=&quot;x&quot;&gt;');
    expect(card.params.text).not.toContain('<b>Boss</b>');
  });

  it('queues the order card for retry when the operators chat is unreachable', async () => {
    vi.restoreAllMocks();
    net = mockNetwork({ fail: (method, p) => (method === 'sendMessage' && String(p.chat_id) === String(ADMIN_CHAT) ? 'chat not found' : undefined) });
    const chat = 2307;
    await onboard(chat);
    await checkoutToConfirm(chat);
    await deliver(callbackUpdate(chat, okButton(net, chat)));
    const [order] = await ordersOf(chat);
    expect(order).toBeDefined();
    expect(order!.admin_message_id).toBeNull();
  });
});

describe('operators', () => {
  async function placedOrder(chat: number): Promise<number> {
    await onboard(chat);
    await checkoutToConfirm(chat);
    await deliver(callbackUpdate(chat, okButton(net, chat)));
    return (await ordersOf(chat))[0]!.id;
  }

  it('only staff can change the status', async () => {
    const chat = 2401;
    const id = await placedOrder(chat);
    await deliver(callbackUpdate(chat, `ad:${id}:confirmed`)); // the customer tries
    expect((await getOrder(env.DB, id))!.status).toBe('new');
    expect(net.of('answerCallbackQuery').at(-1)!.params.text).toContain('operatorlar');
  });

  it('moves the order through its statuses and tells the customer', async () => {
    await env.DB.prepare("UPDATE products SET price = 50000 WHERE id IN ('bistrepen', 'kefen')").run();
    const chat = 2402;
    const id = await placedOrder(chat);
    await env.DB.prepare("UPDATE products SET price = NULL WHERE id IN ('bistrepen', 'kefen')").run();
    net.clear();
    await deliver(callbackUpdate(ADMIN_CHAT, `ad:${id}:confirmed`, 777));
    expect((await getOrder(env.DB, id))!.status).toBe('confirmed');
    const notice = net.lastTo(chat)!;
    expect(notice.params.text).toContain('Tasdiqlandi');
    expect(notice.params.text).toContain('150\u00a0000 soʻm');
    expect(buttons(notice)).toEqual([`https://payme.test/pay?order=${id}&amount=150000`]);
    expect(buttons(net.of('editMessageText').at(-1))).toEqual([`ad:${id}:shipped`, `ad:${id}:cancelled`]);

    await deliver(callbackUpdate(ADMIN_CHAT, `ad:${id}:delivered`, 777)); // skips "shipped"
    expect((await getOrder(env.DB, id))!.status).toBe('confirmed');
    await deliver(callbackUpdate(ADMIN_CHAT, `ad:${id}:shipped`, 777));
    await deliver(callbackUpdate(ADMIN_CHAT, `ad:${id}:delivered`, 777));
    expect((await getOrder(env.DB, id))!.status).toBe('delivered');
    expect(buttons(net.of('editMessageText').at(-1))).toEqual([]);
  });

  it('relays customer questions and operator replies both ways', async () => {
    const chat = 2403;
    await onboard(chat);
    await deliver(textUpdate(chat, 'Bistrepen necha pul?'));
    const forwarded = net.of('sendMessage').find((c) => String(c.params.chat_id) === String(ADMIN_CHAT))!;
    expect(forwarded.params.text).toContain('Bistrepen necha pul?');

    const relay = await env.DB.prepare('SELECT admin_message_id FROM relay WHERE chat_id = ?').bind(chat).first<{ admin_message_id: number }>();
    expect(relay).not.toBeNull();
    net.clear();
    await deliver(
      messageUpdate(ADMIN_CHAT, { text: '120 000 soʻm, ertaga yetkazamiz', reply_to_message: { message_id: relay!.admin_message_id, chat: { id: ADMIN_CHAT, type: 'supergroup' }, date: 0 } }, 777),
    );
    const reply = net.lastTo(chat)!;
    expect(reply.params.text).toContain('Operator');
    expect(reply.params.text).toContain('120 000 soʻm');
    expect(net.texts(ADMIN_CHAT).some((t) => t.includes('Mijozga yuborildi'))).toBe(true);
  });

  it('forwards a receipt photo with the latest order number', async () => {
    const chat = 2404;
    const id = await placedOrder(chat);
    net.clear();
    await deliver(messageUpdate(chat, { photo: [{ file_id: 'small', width: 90, height: 90 }, { file_id: 'big', width: 800, height: 800 }] }));
    expect(net.texts(ADMIN_CHAT).some((t) => t.includes(`buyurtma #${id}`))).toBe(true);
    expect(net.of('copyMessage')[0]!.params).toMatchObject({ from_chat_id: chat, chat_id: '-100777' });
    expect(net.lastTo(chat)!.params.text).toContain(`#${id}`);
  });

  it('saves a product photo sent with /photo and serves it on the web', async () => {
    await deliver(messageUpdate(500, { caption: '/photo kefen', photo: [{ file_id: 'kefen-file', width: 800, height: 800 }] }));
    const row = await env.DB.prepare("SELECT file_id FROM product_photos WHERE product_id = 'kefen'").first<{ file_id: string }>();
    expect(row?.file_id).toBe('kefen-file');
    const page = await (await call(new Request('https://bot.test/'))).text();
    expect(page).toMatch(/\/img\/kefen\?v=/);
    const img = await call(new Request('https://bot.test/img/kefen?v=1'));
    expect(img.status).toBe(200);
    expect(img.headers.get('Content-Type')).toBe('image/jpeg');
    expect(await img.text()).toBe('JPEGDATA');
  });

  it('ignores admin commands from customers', async () => {
    await onboard(2405);
    await deliver(textUpdate(2405, '/sync'));
    await deliver(textUpdate(2405, '/stats'));
    expect(net.texts(2405).some((t) => t.includes('Katalog yangilandi') || t.includes('Statistika'))).toBe(false);
  });

  it('shows open orders and stats to staff', async () => {
    await placedOrder(2406);
    net.clear();
    await deliver(textUpdate(500, '/orders'));
    expect(net.lastTo(500)!.params.text).toContain('Ochiq buyurtmalar');
    await deliver(textUpdate(500, '/stats'));
    expect(net.lastTo(500)!.params.text).toContain('Bugun:');
  });
});

describe('webhook secret check', () => {
  it('uses the configured secret', () => {
    expect(env.WEBHOOK_SECRET).toBe(SECRET);
  });
});
