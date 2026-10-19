import type { Env } from './env';
import * as db from './db';
import {
  ADMIN_COMMANDS,
  adminChatId,
  adminCommand,
  adminStatusCallback,
  isStaff,
  notifyNewOrder,
  parseCommand,
  relayToCustomer,
} from './admin';
import { A, REGIONS, T, isLang, menuKeyOf, regionName, type Lang } from './i18n';
import {
  cartView,
  categoryName,
  confirmView,
  customerOrderLine,
  draftText,
  mainMenu,
  money,
  phoneKeyboard,
  productCard,
  productName,
  totals,
  type PricedLine,
} from './render';
import { pushOrder } from './sheets';
import {
  answerCallback,
  editOrSend,
  inline,
  sendMessage,
  tg,
  TgError,
  type InlineKeyboard,
  type TgCallbackQuery,
  type TgMessage,
  type TgUpdate,
  type TgUser,
  visibleLength,
} from './tg';
import { cleanText, esc, ID_RE, normalizePhone } from './util';

export const MAX_QTY = 9999;
export const MAX_CART_LINES = 30;
const LIMITS = { name: 80, address: 300, note: 500, question: 2000 };
const MESSAGES_PER_DAY = 30;

interface Ctx {
  env: Env;
  exec: ExecutionContext;
  chatId: number;
  user: TgUser;
  s: db.Session;
  lang: Lang;
}

export async function handleUpdate(env: Env, update: TgUpdate, exec: ExecutionContext): Promise<void> {
  if (!Number.isSafeInteger(update.update_id)) return;
  if (!(await db.markUpdate(env.DB, update.update_id))) return;
  try {
    if (update.callback_query) return await handleCallback(env, update.callback_query, exec);
    if (update.message) return await handleMessage(env, update.message, exec);
  } catch (err) {
    // Tell a customer something went wrong instead of leaving them without an answer.
    const chat = update.message?.chat ?? update.callback_query?.message?.chat;
    if (chat?.type === 'private') {
      await sendMessage(env, chat.id, `${T.uz.error}\n${T.ru.error}`).catch(() => undefined);
    }
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Messages

async function handleMessage(env: Env, msg: TgMessage, exec: ExecutionContext): Promise<void> {
  const user = msg.from;
  if (!user || user.is_bot) return;
  const chatId = msg.chat.id;
  const staff = isStaff(env, user.id, chatId);

  // An operator replying in the operators' chat to a forwarded message or an order card.
  if (staff && String(chatId) === adminChatId(env) && msg.reply_to_message) {
    const relay = await db.getRelay(env.DB, msg.reply_to_message.message_id);
    if (relay) {
      await relayToCustomer(env, msg, relay.chat_id);
      return;
    }
  }

  const cmd = parseCommand(msg.text ?? msg.caption ?? '');
  if (cmd?.name === 'id') {
    await sendMessage(env, chatId, `chat_id: <code>${chatId}</code>\nuser_id: <code>${user.id}</code>`);
    return;
  }
  if (staff && cmd && ADMIN_COMMANDS.has(cmd.name)) {
    await adminCommand(env, msg, cmd);
    return;
  }
  if (msg.chat.type !== 'private') return;

  const s = await db.getSession(env.DB, chatId);
  const ctx: Ctx = { env, exec, chatId, user, s, lang: s.lang ?? 'uz' };
  const text = msg.text ?? '';

  if (cmd?.name === 'start') {
    const payload = /^p_[a-z0-9_-]{1,40}$/.test(cmd.arg) ? cmd.arg : '';
    if (!s.lang) {
      s.step = `lang:${payload}`;
      await save(ctx);
      return askLang(ctx);
    }
    s.step = null;
    await save(ctx);
    await sendMessage(env, chatId, T[ctx.lang].welcome, mainMenu(ctx.lang));
    if (payload) await showProduct(ctx, payload.slice(2));
    return;
  }
  if (!s.lang) {
    s.step = 'lang:';
    await save(ctx);
    return askLang(ctx);
  }

  const route = (text && menuKeyOf(text)) || commandRoute(cmd?.name);
  if (route) {
    if (s.step) {
      s.step = null;
      await save(ctx);
    }
    switch (route) {
      case 'catalog':
        return showCategories(ctx);
      case 'cart':
        return showCart(ctx);
      case 'orders':
        return showOrders(ctx);
      case 'contact':
        return showContact(ctx);
      case 'lang':
        return askLang(ctx);
      case 'help':
        await sendMessage(env, chatId, T[ctx.lang].welcome, mainMenu(ctx.lang));
        return;
    }
  }

  const step = s.step ?? '';
  if (step.startsWith('qty:')) return onQuantity(ctx, step.slice(4), text);
  switch (step) {
    case 'name':
      return onName(ctx, msg);
    case 'phone':
      return onPhone(ctx, msg);
    case 'region':
      return askRegion(ctx);
    case 'address':
      return onAddress(ctx, msg);
    case 'note':
      return onNote(ctx, msg);
    case 'saved':
      return askUseSaved(ctx);
    case 'confirm':
      return showConfirm(ctx);
  }
  if (cmd) {
    await sendMessage(env, chatId, T[ctx.lang].welcome, mainMenu(ctx.lang));
    return;
  }
  return forwardToOperator(ctx, msg);
}

function commandRoute(name: string | undefined): 'catalog' | 'cart' | 'orders' | 'contact' | 'lang' | 'help' | null {
  switch (name) {
    case 'catalog':
    case 'cart':
    case 'orders':
    case 'contact':
    case 'lang':
    case 'help':
      return name;
    default:
      return null;
  }
}

async function save(ctx: Ctx): Promise<void> {
  await db.saveSession(ctx.env.DB, ctx.s);
}

async function askLang(ctx: Ctx): Promise<void> {
  await sendMessage(
    ctx.env,
    ctx.chatId,
    T.uz.chooseLang,
    inline([
      [
        { text: '🇺🇿 Oʻzbekcha', callback_data: 'l:uz' },
        { text: '🇷🇺 Русский', callback_data: 'l:ru' },
      ],
    ]),
  );
}

// ---------------------------------------------------------------------------
// Catalog and cart

async function showCategories(ctx: Ctx, message?: TgMessage): Promise<void> {
  const t = T[ctx.lang];
  const cats = await db.listCategories(ctx.env.DB);
  if (!cats.length) {
    await editOrSend(ctx.env, ctx.chatId, message, t.catalogEmpty);
    return;
  }
  if (cats.length === 1) return showCategory(ctx, cats[0]!.category, message, false);
  const keyboard: InlineKeyboard = cats.map((c) => [
    { text: `${categoryName(c, ctx.lang)} (${c.n})`, callback_data: `c:${c.category}` },
  ]);
  keyboard.push([{ text: T[ctx.lang].goToCart, callback_data: 'cart' }]);
  await editOrSend(ctx.env, ctx.chatId, message, t.catalogTitle, inline(keyboard));
}

async function showCategory(ctx: Ctx, category: string, message?: TgMessage, withBack = true): Promise<void> {
  const products = ID_RE.test(category) ? await db.listProducts(ctx.env.DB, category) : [];
  if (!products.length) return showCategories(ctx, message);
  const t = T[ctx.lang];
  const keyboard: InlineKeyboard = products.map((p) => [
    {
      text: `${productName(p, ctx.lang)}${p.price != null ? ` — ${money(p.price, ctx.lang)}` : ''}${p.in_stock ? '' : ' ⏳'}`,
      callback_data: `p:${p.id}`,
    },
  ]);
  keyboard.push(
    withBack
      ? [
          { text: t.back, callback_data: 'cats' },
          { text: t.goToCart, callback_data: 'cart' },
        ]
      : [{ text: t.goToCart, callback_data: 'cart' }],
  );
  await editOrSend(ctx.env, ctx.chatId, message, t.categoryTitle(esc(categoryName(products[0]!, ctx.lang))), inline(keyboard));
}

async function showProduct(ctx: Ctx, id: string): Promise<void> {
  const p = ID_RE.test(id) ? await db.getProduct(ctx.env.DB, id) : null;
  if (!p) {
    await sendMessage(ctx.env, ctx.chatId, T[ctx.lang].productMissing);
    return;
  }
  const altIds = (p.alternatives ?? '').split(',').filter((a) => ID_RE.test(a));
  const alts = [...(await db.getProductsByIds(ctx.env.DB, altIds)).values()];
  const card = productCard(p, ctx.lang, alts);
  const photo = p.photo_file_id || p.photo_url;
  if (photo) {
    try {
      const fits = visibleLength(card.text) <= 1024;
      await tg(ctx.env, 'sendPhoto', {
        chat_id: ctx.chatId,
        photo,
        ...(fits ? { caption: card.text, parse_mode: 'HTML', reply_markup: inline(card.keyboard) } : {}),
      });
      if (fits) return;
    } catch (err) {
      console.warn(`photo for ${p.id} failed: ${err instanceof TgError ? err.description : err}`);
    }
  }
  await sendMessage(ctx.env, ctx.chatId, card.text, inline(card.keyboard));
}

/** Cart lines joined with live products; lines whose product left the catalog are dropped. */
async function pricedCart(ctx: Ctx): Promise<{ lines: PricedLine[]; dropped: boolean }> {
  const products = await db.getProductsByIds(
    ctx.env.DB,
    ctx.s.cart.map((l) => l.id),
  );
  const lines: PricedLine[] = [];
  for (const l of ctx.s.cart) {
    const product = products.get(l.id);
    if (product) lines.push({ product, qty: l.qty });
  }
  const dropped = lines.length !== ctx.s.cart.length;
  if (dropped) {
    ctx.s.cart = lines.map((l) => ({ id: l.product.id, qty: l.qty }));
    await save(ctx);
  }
  return { lines, dropped };
}

async function addToCart(ctx: Ctx, id: string, qty: number): Promise<string | undefined> {
  const t = T[ctx.lang];
  if (!Number.isInteger(qty) || qty < 1 || qty > MAX_QTY) return t.badQty(MAX_QTY);
  const p = ID_RE.test(id) ? await db.getProduct(ctx.env.DB, id) : null;
  if (!p) return t.productMissing;
  const line = ctx.s.cart.find((l) => l.id === id);
  if (line) {
    line.qty = Math.min(MAX_QTY, line.qty + qty);
  } else {
    if (ctx.s.cart.length >= MAX_CART_LINES) return t.cartFull(MAX_CART_LINES);
    ctx.s.cart.push({ id, qty });
  }
  ctx.s.step = null;
  await save(ctx);
  const total = line ? line.qty : qty;
  await sendMessage(
    ctx.env,
    ctx.chatId,
    t.added(esc(productName(p, ctx.lang)), total),
    inline([
      [{ text: t.goToCart, callback_data: 'cart' }],
      [{ text: t.continueShopping, callback_data: `c:${p.category}` }],
    ]),
  );
  return '✅';
}

async function onQuantity(ctx: Ctx, id: string, text: string): Promise<void> {
  const t = T[ctx.lang];
  const qty = /^\s*\d{1,5}\s*$/.test(text) ? Number(text) : NaN;
  if (!Number.isInteger(qty) || qty < 1 || qty > MAX_QTY) {
    await sendMessage(ctx.env, ctx.chatId, t.badQty(MAX_QTY));
    return;
  }
  const problem = await addToCart(ctx, id, qty);
  if (problem && problem !== '✅') {
    ctx.s.step = null;
    await save(ctx);
    await sendMessage(ctx.env, ctx.chatId, problem);
  }
}

async function showCart(ctx: Ctx, message?: TgMessage): Promise<void> {
  const { lines, dropped } = await pricedCart(ctx);
  const view = cartView(lines, ctx.lang);
  const text = dropped ? `${T[ctx.lang].itemsDropped}\n\n${view.text}` : view.text;
  await editOrSend(ctx.env, ctx.chatId, message, text, inline(view.keyboard));
}

async function showOrders(ctx: Ctx): Promise<void> {
  const t = T[ctx.lang];
  const orders = await db.listOrdersForChat(ctx.env.DB, ctx.chatId, 5);
  if (!orders.length) {
    await sendMessage(ctx.env, ctx.chatId, t.ordersEmpty, mainMenu(ctx.lang));
    return;
  }
  await sendMessage(ctx.env, ctx.chatId, [t.ordersTitle, ...orders.map((o) => customerOrderLine(o, ctx.lang))].join('\n\n'));
}

async function showContact(ctx: Ctx): Promise<void> {
  const t = T[ctx.lang];
  const env = ctx.env;
  const lines = [t.contactTitle];
  if (env.CONTACT_PHONE) lines.push(`${t.phone}: ${esc(env.CONTACT_PHONE)}`);
  const extra = ctx.lang === 'ru' ? env.CONTACT_TEXT_RU || env.CONTACT_TEXT_UZ : env.CONTACT_TEXT_UZ || env.CONTACT_TEXT_RU;
  if (extra) lines.push(esc(extra.replace(/\\n/g, '\n')));
  lines.push('', t.contactFallback);
  await sendMessage(ctx.env, ctx.chatId, lines.join('\n'));
}

// ---------------------------------------------------------------------------
// Checkout: name -> phone -> region -> address -> note -> confirm

function cancelRow(lang: Lang): InlineKeyboard {
  return [[{ text: T[lang].cancel, callback_data: 'x' }]];
}

async function startCheckout(ctx: Ctx): Promise<void> {
  const { lines } = await pricedCart(ctx);
  if (!lines.length) return showCart(ctx);
  const saved = await db.getCustomer(ctx.env.DB, ctx.chatId);
  if (saved?.name && saved.phone && saved.region && saved.address) {
    ctx.s.draft = { name: saved.name, phone: saved.phone, region: saved.region, address: saved.address };
    ctx.s.step = 'saved';
    await save(ctx);
    return askUseSaved(ctx);
  }
  ctx.s.draft = {};
  ctx.s.step = 'name';
  await save(ctx);
  await sendMessage(ctx.env, ctx.chatId, T[ctx.lang].askName, inline(cancelRow(ctx.lang)));
}

async function askUseSaved(ctx: Ctx): Promise<void> {
  const t = T[ctx.lang];
  await sendMessage(
    ctx.env,
    ctx.chatId,
    t.useSaved(draftText(ctx.s.draft, ctx.lang)),
    inline([
      [
        { text: t.yes, callback_data: 'sv:y' },
        { text: t.edit, callback_data: 'sv:n' },
      ],
      ...cancelRow(ctx.lang),
    ]),
  );
}

/** Text answer for a checkout step, or null after telling the user what is wrong. */
async function textAnswer(ctx: Ctx, msg: TgMessage, min: number, max: number): Promise<string | null> {
  const t = T[ctx.lang];
  const value = cleanText(msg.text);
  if (!value || value.startsWith('/') || value.length < min) {
    await sendMessage(ctx.env, ctx.chatId, t.needText);
    return null;
  }
  if (value.length > max) {
    await sendMessage(ctx.env, ctx.chatId, t.tooLong(max));
    return null;
  }
  return value;
}

async function onName(ctx: Ctx, msg: TgMessage): Promise<void> {
  const name = await textAnswer(ctx, msg, 2, LIMITS.name);
  if (!name) return;
  ctx.s.draft.name = name;
  ctx.s.step = 'phone';
  await save(ctx);
  await sendMessage(ctx.env, ctx.chatId, T[ctx.lang].askPhone, phoneKeyboard(ctx.lang));
}

async function onPhone(ctx: Ctx, msg: TgMessage): Promise<void> {
  const t = T[ctx.lang];
  const raw = msg.contact?.phone_number ?? msg.text ?? '';
  const phone = normalizePhone(msg.contact && !raw.startsWith('+') ? `+${raw}` : raw);
  if (!phone) {
    await sendMessage(ctx.env, ctx.chatId, t.badPhone, phoneKeyboard(ctx.lang));
    return;
  }
  ctx.s.draft.phone = phone;
  ctx.s.step = 'region';
  await save(ctx);
  await sendMessage(ctx.env, ctx.chatId, t.phoneSaved(esc(phone)), mainMenu(ctx.lang));
  await askRegion(ctx);
}

async function askRegion(ctx: Ctx): Promise<void> {
  const keyboard: InlineKeyboard = [];
  for (let i = 0; i < REGIONS.length; i += 2) {
    keyboard.push(REGIONS.slice(i, i + 2).map((r) => ({ text: r[ctx.lang], callback_data: `rg:${r.key}` })));
  }
  keyboard.push(...cancelRow(ctx.lang));
  await sendMessage(ctx.env, ctx.chatId, T[ctx.lang].askRegion, inline(keyboard));
}

async function onRegion(ctx: Ctx, key: string, message?: TgMessage): Promise<string | undefined> {
  if (ctx.s.step !== 'region') return T[ctx.lang].staleButton;
  if (!REGIONS.some((r) => r.key === key)) return T[ctx.lang].staleButton;
  ctx.s.draft.region = key;
  ctx.s.step = 'address';
  await save(ctx);
  const t = T[ctx.lang];
  await editOrSend(ctx.env, ctx.chatId, message, `${t.fRegion}: ${esc(regionName(key, ctx.lang))} ✅`);
  await sendMessage(ctx.env, ctx.chatId, t.askAddress, inline(cancelRow(ctx.lang)));
  return undefined;
}

async function onAddress(ctx: Ctx, msg: TgMessage): Promise<void> {
  const address = await textAnswer(ctx, msg, 3, LIMITS.address);
  if (!address) return;
  ctx.s.draft.address = address;
  ctx.s.step = 'note';
  await save(ctx);
  await askNote(ctx);
}

async function askNote(ctx: Ctx): Promise<void> {
  const t = T[ctx.lang];
  await sendMessage(ctx.env, ctx.chatId, t.askNote, inline([[{ text: t.skip, callback_data: 'sk' }], ...cancelRow(ctx.lang)]));
}

async function onNote(ctx: Ctx, msg: TgMessage): Promise<void> {
  const note = await textAnswer(ctx, msg, 1, LIMITS.note);
  if (!note) return;
  ctx.s.draft.note = note;
  ctx.s.step = 'confirm';
  await save(ctx);
  await showConfirm(ctx);
}

function draftComplete(d: db.Draft): boolean {
  return !!(d.name && d.phone && d.region && d.address);
}

function orderItems(lines: PricedLine[]): db.OrderItem[] {
  return lines.map(({ product: p, qty }) => ({
    id: p.id,
    name: p.name,
    name_ru: p.name_ru,
    qty,
    price: p.price,
    unit_uz: p.unit_uz,
    unit_ru: p.unit_ru,
  }));
}

async function showConfirm(ctx: Ctx, message?: TgMessage): Promise<void> {
  const { lines, dropped } = await pricedCart(ctx);
  if (!lines.length || !draftComplete(ctx.s.draft)) {
    ctx.s.step = null;
    await save(ctx);
    return showCart(ctx);
  }
  const view = confirmView(orderItems(lines), ctx.s.draft, ctx.lang);
  const text = dropped ? `${T[ctx.lang].itemsDropped}\n\n${view.text}` : view.text;
  await editOrSend(ctx.env, ctx.chatId, message, text, inline(view.keyboard));
}

async function placeOrder(ctx: Ctx, message?: TgMessage): Promise<string | undefined> {
  const t = T[ctx.lang];
  if (ctx.s.step !== 'confirm') return t.staleButton;
  const { lines, dropped } = await pricedCart(ctx);
  if (dropped || !lines.length || !draftComplete(ctx.s.draft)) {
    // The catalog changed since the summary was shown: show the new summary instead.
    await showConfirm(ctx);
    return undefined;
  }
  const items = orderItems(lines);
  const { sum, complete } = totals(items);
  const d = ctx.s.draft;
  const orderId = await db.createOrderFromSession(ctx.env.DB, {
    chat_id: ctx.chatId,
    username: ctx.user.username ?? null,
    lang: ctx.lang,
    customer_name: d.name!,
    phone: d.phone!,
    region: d.region!,
    address: d.address!,
    note: d.note ?? null,
    items,
    total: complete ? sum : null,
  });
  if (orderId === null) return t.staleButton;
  ctx.s.step = null;
  ctx.s.cart = [];

  await editOrSend(ctx.env, ctx.chatId, message, t.orderPlaced(orderId));
  const order = await db.getOrder(ctx.env.DB, orderId);
  if (order) {
    try {
      await notifyNewOrder(ctx.env, order);
    } catch (err) {
      // The cron job retries orders whose card never reached the operators.
      console.error(`order #${orderId}: admin notify failed: ${err instanceof Error ? err.message : err}`);
    }
    ctx.exec.waitUntil(pushOrder(ctx.env, order));
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Free-form messages go to the operators

async function whoText(ctx: Ctx): Promise<string> {
  const u = ctx.user;
  const customer = await db.getCustomer(ctx.env.DB, ctx.chatId);
  const parts = [esc([u.first_name, u.last_name].filter(Boolean).join(' '))];
  if (u.username) parts.push(`@${esc(u.username)}`);
  if (customer?.phone) parts.push(esc(customer.phone));
  parts.push(ctx.lang === 'ru' ? 'rus' : 'oʻzbek');
  return parts.join(' · ');
}

async function forwardToOperator(ctx: Ctx, msg: TgMessage): Promise<void> {
  const { env, chatId } = ctx;
  const t = T[ctx.lang];
  const adminChat = adminChatId(env);
  if (!adminChat) {
    await sendMessage(env, chatId, t.error);
    return;
  }
  const since = new Date(Date.now() - 86400_000).toISOString();
  if ((await db.countRecentRelays(env.DB, chatId, since)) >= MESSAGES_PER_DAY) {
    await sendMessage(env, chatId, t.tooManyMessages);
    return;
  }
  const who = await whoText(ctx);
  if (msg.text !== undefined) {
    const body = msg.text.slice(0, LIMITS.question);
    const sent = await sendMessage(env, adminChat, `${A.question(who)}\n\n${esc(body)}\n\n${A.replyHint}`);
    await db.addRelay(env.DB, sent.message_id, chatId, null);
    await sendMessage(env, chatId, t.questionForwarded);
    return;
  }
  // Photo, file, voice...: most often a payment receipt for the latest order.
  const [last] = await db.listOrdersForChat(env.DB, chatId, 1);
  const recent =
    last && last.status !== 'cancelled' && Date.now() - Date.parse(last.created_at) < 14 * 86400_000 ? last : undefined;
  const header = recent ? A.receipt(recent.id, who) : A.question(who);
  const head = await sendMessage(env, adminChat, `${header}\n\n${A.replyHint}`);
  await db.addRelay(env.DB, head.message_id, chatId, recent?.id ?? null);
  const copy = await tg<{ message_id: number }>(env, 'copyMessage', {
    chat_id: adminChat,
    from_chat_id: chatId,
    message_id: msg.message_id,
  });
  await db.addRelay(env.DB, copy.message_id, chatId, recent?.id ?? null);
  await sendMessage(env, chatId, recent ? t.receiptForwarded(recent.id) : t.questionForwarded);
}

// ---------------------------------------------------------------------------
// Inline buttons

const NAVIGATION = new Set(['cats', 'c', 'p', 'a', 'cart', 'ord']);

async function handleCallback(env: Env, cb: TgCallbackQuery, exec: ExecutionContext): Promise<void> {
  let toast: string | undefined;
  try {
    const data = cb.data ?? '';
    if (data.startsWith('ad:')) {
      toast = await adminStatusCallback(env, cb, exec);
      return;
    }
    const message = cb.message;
    if (!message || message.chat.type !== 'private') return;
    const s = await db.getSession(env.DB, message.chat.id);
    const ctx: Ctx = { env, exec, chatId: message.chat.id, user: cb.from, s, lang: s.lang ?? 'uz' };
    toast = await customerCallback(ctx, data, message);
  } finally {
    await answerCallback(env, cb.id, toast);
  }
}

async function customerCallback(ctx: Ctx, data: string, message: TgMessage): Promise<string | undefined> {
  const [kind = '', a = '', b = ''] = data.split(':');
  const s = ctx.s;

  if (kind === 'l') {
    if (!isLang(a)) return undefined;
    const pending = s.step?.startsWith('lang:') ? s.step.slice(5) : '';
    s.lang = a;
    ctx.lang = a;
    if (s.step?.startsWith('lang:')) s.step = null;
    await save(ctx);
    await editOrSend(ctx.env, ctx.chatId, message, T[a].langSaved);
    await sendMessage(ctx.env, ctx.chatId, T[a].welcome, mainMenu(a));
    if (pending.startsWith('p_')) await showProduct(ctx, pending.slice(2));
    return undefined;
  }
  if (!s.lang) {
    await askLang(ctx);
    return undefined;
  }
  if (NAVIGATION.has(kind) && s.step && !s.step.startsWith('lang:')) {
    s.step = null;
    await save(ctx);
  }

  switch (kind) {
    case 'cats':
      await showCategories(ctx, message);
      return undefined;
    case 'c':
      await showCategory(ctx, a, message);
      return undefined;
    case 'p':
      await showProduct(ctx, a);
      return undefined;
    case 'a':
      return addToCart(ctx, a, Number(b));
    case 'q':
      if (!ID_RE.test(a)) return undefined;
      s.step = `qty:${a}`;
      await save(ctx);
      await sendMessage(ctx.env, ctx.chatId, T[ctx.lang].askQty);
      return undefined;
    case 'cart':
      await showCart(ctx, message);
      return undefined;
    case 'r':
      s.cart = s.cart.filter((l) => l.id !== a);
      await save(ctx);
      await showCart(ctx, message);
      return undefined;
    case 'clr':
      s.cart = [];
      if (s.step) s.step = null;
      await save(ctx);
      await editOrSend(
        ctx.env,
        ctx.chatId,
        message,
        T[ctx.lang].cartCleared,
        inline([[{ text: T[ctx.lang].toCatalog, callback_data: 'cats' }]]),
      );
      return undefined;
    case 'co':
      await startCheckout(ctx);
      return undefined;
    case 'sv':
      if (s.step !== 'saved') return T[ctx.lang].staleButton;
      if (a === 'y') {
        s.step = 'note';
        await save(ctx);
        await askNote(ctx);
      } else {
        s.draft = {};
        s.step = 'name';
        await save(ctx);
        await sendMessage(ctx.env, ctx.chatId, T[ctx.lang].askName, inline(cancelRow(ctx.lang)));
      }
      return undefined;
    case 'rg':
      return onRegion(ctx, a, message);
    case 'sk':
      if (s.step !== 'note') return T[ctx.lang].staleButton;
      delete s.draft.note;
      s.step = 'confirm';
      await save(ctx);
      await showConfirm(ctx);
      return undefined;
    case 'ok':
      return placeOrder(ctx, message);
    case 'x': {
      const inCheckout = !!s.step && !s.step.startsWith('lang:');
      s.step = null;
      await save(ctx);
      try {
        await tg(ctx.env, 'editMessageReplyMarkup', { chat_id: ctx.chatId, message_id: message.message_id });
      } catch {
        // already without buttons
      }
      if (inCheckout) await sendMessage(ctx.env, ctx.chatId, T[ctx.lang].checkoutCancelled, mainMenu(ctx.lang));
      return undefined;
    }
    case 'ord':
      await showOrders(ctx);
      return undefined;
    default:
      return T[ctx.lang].staleButton;
  }
}
