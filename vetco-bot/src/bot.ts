import type { Env } from './env';
import * as db from './db';
import {
  ADMIN_COMMANDS,
  adminChatId,
  adminCommand,
  adminStatusCallback,
  copyToOperators,
  followChatMove,
  isStaff,
  notifyNewOrder,
  parseCommand,
  postToOperators,
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
  quoteHash,
  quoteOf,
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
/** Customer messages forwarded to the operators per rolling 24 hours. */
const MESSAGES_PER_DAY = 30;
/** Orders per chat per rolling 24 hours: stops a script from flooding the operators. */
export const ORDERS_PER_DAY = 5;
/** A checkout left this long is forgotten, so later receipts and questions reach the operators. */
const STEP_TTL_MS = 30 * 60_000;
const CHECKOUT_STEPS = new Set(['name', 'phone', 'region', 'address', 'note', 'saved', 'confirm']);
/** Message contents copyMessage can copy; service messages (pins, timers...) are not among them. */
const COPYABLE = ['photo', 'document', 'video', 'voice', 'audio', 'video_note', 'animation', 'sticker', 'location', 'venue', 'poll', 'dice'];

function copyable(msg: TgMessage): boolean {
  return COPYABLE.some((k) => (msg as unknown as Record<string, unknown>)[k] !== undefined);
}

/** "15", "15 ta", "15 шт", "15 флаконов" */
const QTY_RE = /^\s*(\d{1,5})\s*(?:ta|dona|flakon|fl\.?|шт\.?|штук[аи]?|флакон(?:а|ов)?|фл\.?)?\s*$/iu;

export function parseQty(text: string): number | null {
  const m = QTY_RE.exec(text);
  const qty = m ? Number(m[1]) : NaN;
  return Number.isInteger(qty) && qty >= 1 && qty <= MAX_QTY ? qty : null;
}

interface Ctx {
  env: Env;
  exec: ExecutionContext;
  chatId: number;
  user: TgUser;
  s: db.Session;
  lang: Lang;
}

/** Handles an update whose id is already recorded as processed (see index.ts). */
export async function handleUpdate(env: Env, update: TgUpdate, exec: ExecutionContext): Promise<void> {
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
  const chatId = msg.chat.id;
  const inAdminChat = adminChatId(env) !== '' && String(chatId) === adminChatId(env);

  // The operators' basic group became a supergroup with a new id: follow it.
  if (inAdminChat && msg.migrate_to_chat_id) {
    await followChatMove(env, msg.migrate_to_chat_id);
    return;
  }
  // An anonymous group admin writes as the group itself (from = @GroupAnonymousBot).
  const anonymousStaff = inAdminChat && msg.sender_chat?.id === chatId;
  const user = msg.from;
  if (!user || (user.is_bot && !anonymousStaff)) return;
  const staff = anonymousStaff || isStaff(env, user.id, chatId);
  const cmd = parseCommand(msg.text ?? msg.caption ?? '');

  // An operator replying in the operators' chat to a forwarded message or an order card.
  if (staff && inAdminChat && msg.reply_to_message && !cmd) {
    const relay = await db.getRelay(env.DB, adminChatId(env), msg.reply_to_message.message_id);
    if (relay) {
      await relayToCustomer(env, msg, relay.chat_id);
      return;
    }
  }

  if (cmd?.name === 'id') {
    await sendMessage(env, chatId, `chat_id: <code>${chatId}</code>\nuser_id: <code>${user.id}</code>`);
    return;
  }
  // Order lists carry customers' phones: only in a private chat or the operators' chat.
  if (staff && cmd && ADMIN_COMMANDS.has(cmd.name) && (msg.chat.type === 'private' || inAdminChat)) {
    await adminCommand(env, msg, cmd);
    return;
  }
  if (msg.chat.type !== 'private') return;

  const s = await db.getSession(env.DB, chatId);
  const ctx: Ctx = { env, exec, chatId, user, s, lang: s.lang ?? 'uz' };
  const text = msg.text ?? '';

  // A checkout left half-way must not swallow later receipts and questions.
  if (s.step && !s.step.startsWith('lang:') && s.updated_at && Date.now() - Date.parse(s.updated_at) > STEP_TTL_MS) {
    s.step = null;
    await save(ctx);
  }

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
    await leaveStep(ctx);
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
  // A contact from a leftover "share phone" button outside the phone step.
  if (msg.contact && step !== 'phone') {
    await sendMessage(env, chatId, T[ctx.lang].useMenu, mainMenu(ctx.lang));
    return;
  }
  if (msg.text === undefined && !msg.contact) {
    // Photos, files and voice notes always go to the operators (often a payment receipt).
    if (copyable(msg)) return forwardToOperator(ctx, msg);
    return; // a pin or another service message: nothing to pass on
  }

  if (step.startsWith('qty:')) return onQuantity(ctx, msg, step.slice(4), false);
  if (step.startsWith('qty?:')) {
    // An unknown command or a reply to another message is not an answer to "how many?".
    if (cmd || msg.reply_to_message) {
      s.step = null;
      await save(ctx);
    } else {
      return onQuantity(ctx, msg, step.slice(5), true);
    }
  }
  switch (step) {
    case 'name':
      return onName(ctx, msg);
    case 'phone':
      return onPhone(ctx, msg);
    case 'address':
      return onAddress(ctx, msg);
    case 'note':
      return onNote(ctx, msg);
    case 'region':
    case 'saved':
    case 'confirm':
      // These steps wait for a button. A question still reaches the operators.
      if (text.includes('?')) await forwardToOperator(ctx, msg);
      await sendMessage(env, chatId, T[ctx.lang].useButtons);
      if (step === 'region') return askRegion(ctx);
      if (step === 'saved') return askUseSaved(ctx);
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

/** Clears the current step; leaving a checkout restores the main menu and says so. */
async function leaveStep(ctx: Ctx): Promise<void> {
  const step = ctx.s.step;
  if (!step || step.startsWith('lang:')) return;
  ctx.s.step = null;
  await save(ctx);
  if (CHECKOUT_STEPS.has(step)) {
    await sendMessage(ctx.env, ctx.chatId, T[ctx.lang].checkoutCancelled, mainMenu(ctx.lang));
  }
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
  // The card ends with "how many?": a number typed next goes into the cart for this product.
  ctx.s.step = `qty?:${p.id}`;
  await save(ctx);
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
    t.added(esc(productName(p, ctx.lang)), qty, total),
    inline([
      [{ text: t.goToCart, callback_data: 'cart' }],
      [{ text: t.continueShopping, callback_data: `c:${p.category}` }],
    ]),
  );
  return '✅';
}

/**
 * A typed quantity. After "✍️ Other amount" (soft = false) anything else is an error;
 * after merely viewing a card (soft = true) other text is a question for the operators.
 */
async function onQuantity(ctx: Ctx, msg: TgMessage, id: string, soft: boolean): Promise<void> {
  const t = T[ctx.lang];
  const qty = parseQty(msg.text ?? '');
  if (qty === null) {
    if (soft) {
      ctx.s.step = null;
      await save(ctx);
      return forwardToOperator(ctx, msg);
    }
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

async function showCart(ctx: Ctx, message?: TgMessage, droppedBefore = false): Promise<void> {
  const { lines, dropped } = await pricedCart(ctx);
  const view = cartView(lines, ctx.lang);
  const text = dropped || droppedBefore ? `${T[ctx.lang].itemsDropped}\n\n${view.text}` : view.text;
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
  const { lines, dropped } = await pricedCart(ctx);
  if (!lines.length) return showCart(ctx, undefined, dropped);
  if (dropped) await sendMessage(ctx.env, ctx.chatId, T[ctx.lang].itemsDropped);
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

/** Shows the summary and remembers exactly what it showed: confirming places that, nothing else. */
async function showConfirm(ctx: Ctx, message?: TgMessage, notice?: string): Promise<void> {
  const { lines, dropped } = await pricedCart(ctx);
  if (!lines.length || !draftComplete(ctx.s.draft)) {
    ctx.s.step = null;
    await save(ctx);
    return showCart(ctx, undefined, dropped);
  }
  const items = orderItems(lines);
  const quote = quoteOf(items);
  const changed = !!ctx.s.draft.quote && ctx.s.draft.quote !== quote;
  ctx.s.draft.quote = quote;
  ctx.s.step = 'confirm';
  await save(ctx);
  const t = T[ctx.lang];
  const view = confirmView(items, ctx.s.draft, ctx.lang, dropped ? t.itemsDropped : (notice ?? (changed ? t.quoteChanged : undefined)));
  await editOrSend(ctx.env, ctx.chatId, message, view.text, inline(view.keyboard));
}

/** `shown` is the hash carried by the Confirm button: it names the summary the customer saw. */
async function placeOrder(ctx: Ctx, shown: string, message?: TgMessage): Promise<string | undefined> {
  const t = T[ctx.lang];
  if (ctx.s.step !== 'confirm') return t.staleButton;
  const { lines, dropped } = await pricedCart(ctx);
  const items = orderItems(lines);
  if (!lines.length || !draftComplete(ctx.s.draft)) {
    await showConfirm(ctx, message, dropped ? t.itemsDropped : undefined);
    return undefined;
  }
  if (dropped || quoteHash(quoteOf(items)) !== shown) {
    // Prices or the cart changed since that summary: replace it with the current one.
    await showConfirm(ctx, message, dropped ? t.itemsDropped : t.quoteChanged);
    return undefined;
  }
  const since = new Date(Date.now() - 86400_000).toISOString();
  const phone = ctx.env.CONTACT_PHONE ? esc(ctx.env.CONTACT_PHONE) : null;
  if ((await db.countOrdersSince(ctx.env.DB, ctx.chatId, since)) >= ORDERS_PER_DAY) {
    await sendMessage(ctx.env, ctx.chatId, t.tooManyOrders(phone));
    return undefined;
  }
  const { sum, complete } = totals(items);
  const d = ctx.s.draft;
  const orderId = await db.createOrderFromSession(
    ctx.env.DB,
    {
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
    },
    { sinceIso: since, max: ORDERS_PER_DAY },
  );
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
  if (!adminChatId(env)) {
    await sendMessage(env, chatId, t.error);
    return;
  }
  // From here the conversation is with the operators: a later "40" answers them, not a product card.
  if (ctx.s.step?.startsWith('qty?:')) {
    ctx.s.step = null;
    await save(ctx);
  }
  const since = new Date(Date.now() - 86400_000).toISOString();
  const overLimit = (await db.countInbound(env.DB, chatId, since)) >= MESSAGES_PER_DAY;
  // Every photo of an album arrives as its own message: one header, one answer and one count per album.
  const album = msg.media_group_id;
  if (album) {
    const first = await db.claimAlbum(env.DB, chatId, album, overLimit ? 'refused' : 'sent');
    if (first === 'refused') return;
    if (first === 'sent') {
      await copyToOperators(env, chatId, msg.message_id, { chatId, orderId: null, kind: 'copy' });
      return;
    }
  }
  if (overLimit) {
    await sendMessage(env, chatId, t.tooManyMessages(env.CONTACT_PHONE ? esc(env.CONTACT_PHONE) : null));
    return;
  }
  const who = await whoText(ctx);
  if (msg.text !== undefined) {
    const body = msg.text.slice(0, LIMITS.question);
    await postToOperators(env, `${A.question(who)}\n\n${esc(body)}\n\n${A.replyHint}`, { chatId, orderId: null, kind: 'in' });
    await sendMessage(env, chatId, t.questionForwarded);
    return;
  }
  // A photo or file is most often a payment receipt for the latest order.
  const [last] = msg.photo || msg.document ? await db.listOrdersForChat(env.DB, chatId, 1) : [];
  const recent =
    last && last.status !== 'cancelled' && Date.now() - Date.parse(last.created_at) < 14 * 86400_000 ? last : undefined;
  const header = recent ? A.receipt(recent.id, who) : A.question(who);
  const orderId = recent?.id ?? null;
  await postToOperators(env, `${header}\n\n${A.replyHint}`, { chatId, orderId, kind: 'in' });
  await copyToOperators(env, chatId, msg.message_id, { chatId, orderId, kind: 'copy' });
  await sendMessage(env, chatId, recent ? t.receiptForwarded(recent.id) : t.questionForwarded);
}

// ---------------------------------------------------------------------------
// Inline buttons

const NAVIGATION = new Set(['cats', 'c', 'p', 'a', 'cart', 'r', 'ord']);

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
  if (NAVIGATION.has(kind)) await leaveStep(ctx);

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
      return placeOrder(ctx, a, message);
    case 'x':
      try {
        await tg(ctx.env, 'editMessageReplyMarkup', { chat_id: ctx.chatId, message_id: message.message_id });
      } catch {
        // already without buttons
      }
      await leaveStep(ctx);
      return undefined;
    case 'ord':
      await showOrders(ctx);
      return undefined;
    default:
      return T[ctx.lang].staleButton;
  }
}
