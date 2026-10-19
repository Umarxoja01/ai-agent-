import type { Lang, Status } from './i18n';
import { nowIso } from './util';

export interface Product {
  id: string;
  sort: number;
  category: string;
  category_uz: string | null;
  category_ru: string | null;
  name: string;
  name_ru: string | null;
  maker: string | null;
  form_uz: string | null;
  form_ru: string | null;
  ingredient: string | null;
  description_uz: string | null;
  description_ru: string | null;
  dose_uz: string | null;
  dose_ru: string | null;
  dose_verified: number;
  unit_uz: string | null;
  unit_ru: string | null;
  price: number | null;
  in_stock: number;
  active: number;
  photo_url: string | null;
  alternatives: string | null;
  updated_at: string;
  photo_file_id: string | null;
}

export interface CartLine {
  id: string;
  qty: number;
}

export interface Draft {
  name?: string;
  phone?: string;
  region?: string;
  address?: string;
  note?: string;
  /** Lines and prices of the summary the customer is looking at: "id:qty:price|..." */
  quote?: string;
}

export interface Session {
  chat_id: number;
  lang: Lang | null;
  step: string | null;
  cart: CartLine[];
  draft: Draft;
  updated_at: string | null;
}

export interface OrderItem {
  id: string;
  name: string;
  name_ru: string | null;
  qty: number;
  price: number | null;
  unit_uz: string | null;
  unit_ru: string | null;
}

export interface Order {
  id: number;
  chat_id: number;
  username: string | null;
  lang: Lang;
  customer_name: string;
  phone: string;
  region: string;
  address: string;
  note: string | null;
  items: OrderItem[];
  total: number | null;
  status: Status;
  admin_message_id: number | null;
  sheets_synced: number;
  created_at: string;
  updated_at: string;
}

export interface Customer {
  chat_id: number;
  username: string | null;
  name: string | null;
  phone: string | null;
  region: string | null;
  address: string | null;
}

const PRODUCT_SELECT = `SELECT p.*, ph.file_id AS photo_file_id FROM products p LEFT JOIN product_photos ph ON ph.product_id = p.id`;

function parseJson<T>(text: unknown, fallback: T): T {
  if (typeof text !== 'string') return fallback;
  try {
    return JSON.parse(text) as T;
  } catch {
    return fallback;
  }
}

/** Returns true the first time an update id is seen. */
export async function markUpdate(db: D1Database, updateId: number): Promise<boolean> {
  const res = await db
    .prepare('INSERT OR IGNORE INTO processed_updates (update_id, created_at) VALUES (?, ?)')
    .bind(updateId, nowIso())
    .run();
  return (res.meta.changes ?? 0) > 0;
}

export async function getSession(db: D1Database, chatId: number): Promise<Session> {
  const row = await db
    .prepare('SELECT chat_id, lang, step, cart, draft, updated_at FROM sessions WHERE chat_id = ?')
    .bind(chatId)
    .first<{ chat_id: number; lang: string | null; step: string | null; cart: string; draft: string; updated_at: string }>();
  if (!row) return { chat_id: chatId, lang: null, step: null, cart: [], draft: {}, updated_at: null };
  const cart = parseJson<CartLine[]>(row.cart, []);
  return {
    chat_id: row.chat_id,
    lang: row.lang === 'uz' || row.lang === 'ru' ? row.lang : null,
    step: row.step,
    cart: Array.isArray(cart) ? cart : [],
    draft: parseJson<Draft>(row.draft, {}),
    updated_at: row.updated_at,
  };
}

export async function saveSession(db: D1Database, s: Session): Promise<void> {
  await db
    .prepare(
      `INSERT INTO sessions (chat_id, lang, step, cart, draft, updated_at) VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(chat_id) DO UPDATE SET lang = excluded.lang, step = excluded.step, cart = excluded.cart,
         draft = excluded.draft, updated_at = excluded.updated_at`,
    )
    .bind(s.chat_id, s.lang, s.step, JSON.stringify(s.cart), JSON.stringify(s.draft), nowIso())
    .run();
}

export async function listCategories(
  db: D1Database,
): Promise<{ category: string; category_uz: string | null; category_ru: string | null; n: number }[]> {
  const { results } = await db
    .prepare(
      `SELECT category, MAX(category_uz) AS category_uz, MAX(category_ru) AS category_ru, COUNT(*) AS n, MIN(sort) AS s
       FROM products WHERE active = 1 GROUP BY category ORDER BY s, category`,
    )
    .all<{ category: string; category_uz: string | null; category_ru: string | null; n: number }>();
  return results;
}

export async function listProducts(db: D1Database, category?: string): Promise<Product[]> {
  const stmt = category
    ? db.prepare(`${PRODUCT_SELECT} WHERE p.active = 1 AND p.category = ? ORDER BY p.sort, p.name`).bind(category)
    : db.prepare(`${PRODUCT_SELECT} WHERE p.active = 1 ORDER BY p.sort, p.name`);
  const { results } = await stmt.all<Product>();
  return results;
}

export async function getProduct(db: D1Database, id: string, activeOnly = true): Promise<Product | null> {
  return db
    .prepare(`${PRODUCT_SELECT} WHERE p.id = ?${activeOnly ? ' AND p.active = 1' : ''}`)
    .bind(id)
    .first<Product>();
}

export async function getProductsByIds(db: D1Database, ids: string[]): Promise<Map<string, Product>> {
  const map = new Map<string, Product>();
  if (!ids.length) return map;
  const { results } = await db
    .prepare(`${PRODUCT_SELECT} WHERE p.active = 1 AND p.id IN (SELECT value FROM json_each(?))`)
    .bind(JSON.stringify(ids))
    .all<Product>();
  for (const p of results) map.set(p.id, p);
  return map;
}

export async function setProductPhoto(db: D1Database, productId: string, fileId: string): Promise<void> {
  await db
    .prepare(
      `INSERT INTO product_photos (product_id, file_id, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(product_id) DO UPDATE SET file_id = excluded.file_id, updated_at = excluded.updated_at`,
    )
    .bind(productId, fileId, nowIso())
    .run();
}

export async function getCustomer(db: D1Database, chatId: number): Promise<Customer | null> {
  return db.prepare('SELECT * FROM customers WHERE chat_id = ?').bind(chatId).first<Customer>();
}

function rowToOrder(row: Record<string, unknown>): Order {
  return { ...(row as unknown as Order), items: parseJson<OrderItem[]>(row.items, []) };
}

export interface NewOrder {
  chat_id: number;
  username: string | null;
  lang: Lang;
  customer_name: string;
  phone: string;
  region: string;
  address: string;
  note: string | null;
  items: OrderItem[];
  total: number | null;
}

export interface OrderLimit {
  sinceIso: string;
  max: number;
}

export async function countOrdersSince(db: D1Database, chatId: number, sinceIso: string): Promise<number> {
  const row = await db
    .prepare('SELECT COUNT(*) AS n FROM orders WHERE chat_id = ? AND created_at > ?')
    .bind(chatId, sinceIso)
    .first<{ n: number }>();
  return row?.n ?? 0;
}

/**
 * Creates the order and empties the cart in one transaction, but only while the
 * session is still waiting for confirmation and the chat is under its daily order
 * limit. A second tap on "Confirm" finds the step already cleared and creates
 * nothing. Returns the new order id or null.
 */
export async function createOrderFromSession(db: D1Database, o: NewOrder, limit: OrderLimit): Promise<number | null> {
  const now = nowIso();
  const [insert] = await db.batch([
    db
      .prepare(
        `INSERT INTO orders (chat_id, username, lang, customer_name, phone, region, address, note, items, total,
           status, created_at, updated_at)
         SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'new', ?, ?
         WHERE EXISTS (SELECT 1 FROM sessions WHERE chat_id = ? AND step = 'confirm')
           AND (SELECT COUNT(*) FROM orders WHERE chat_id = ? AND created_at > ?) < ?`,
      )
      .bind(
        o.chat_id,
        o.username,
        o.lang,
        o.customer_name,
        o.phone,
        o.region,
        o.address,
        o.note,
        JSON.stringify(o.items),
        o.total,
        now,
        now,
        o.chat_id,
        o.chat_id,
        limit.sinceIso,
        limit.max,
      ),
    db
      .prepare(
        `UPDATE sessions SET step = NULL, cart = '[]', updated_at = ? WHERE chat_id = ? AND step = 'confirm'
           AND (SELECT COUNT(*) FROM orders WHERE chat_id = ? AND created_at = ?) > 0`,
      )
      .bind(now, o.chat_id, o.chat_id, now),
    db
      .prepare(
        `INSERT INTO customers (chat_id, username, name, phone, region, address, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(chat_id) DO UPDATE SET username = excluded.username, name = excluded.name, phone = excluded.phone,
           region = excluded.region, address = excluded.address, updated_at = excluded.updated_at`,
      )
      .bind(o.chat_id, o.username, o.customer_name, o.phone, o.region, o.address, now),
  ]);
  if (!insert || (insert.meta.changes ?? 0) === 0) return null;
  return Number(insert.meta.last_row_id);
}

export async function getOrder(db: D1Database, id: number): Promise<Order | null> {
  const row = await db.prepare('SELECT * FROM orders WHERE id = ?').bind(id).first<Record<string, unknown>>();
  return row ? rowToOrder(row) : null;
}

export async function listOrdersForChat(db: D1Database, chatId: number, limit = 5): Promise<Order[]> {
  const { results } = await db
    .prepare('SELECT * FROM orders WHERE chat_id = ? ORDER BY id DESC LIMIT ?')
    .bind(chatId, limit)
    .all<Record<string, unknown>>();
  return results.map(rowToOrder);
}

export async function listOpenOrders(db: D1Database, limit = 15): Promise<Order[]> {
  const { results } = await db
    .prepare(`SELECT * FROM orders WHERE status IN ('new', 'confirmed', 'shipped') ORDER BY id DESC LIMIT ?`)
    .bind(limit)
    .all<Record<string, unknown>>();
  return results.map(rowToOrder);
}

export async function listOrdersSince(db: D1Database, sinceId: number, limit: number): Promise<Order[]> {
  const { results } = await db
    .prepare('SELECT * FROM orders WHERE id > ? ORDER BY id LIMIT ?')
    .bind(sinceId, limit)
    .all<Record<string, unknown>>();
  return results.map(rowToOrder);
}

export async function listUnnotifiedOrders(db: D1Database, beforeIso: string, limit: number): Promise<Order[]> {
  const { results } = await db
    .prepare('SELECT * FROM orders WHERE admin_message_id IS NULL AND created_at < ? ORDER BY id LIMIT ?')
    .bind(beforeIso, limit)
    .all<Record<string, unknown>>();
  return results.map(rowToOrder);
}

export async function listUnsyncedOrders(db: D1Database, limit: number): Promise<Order[]> {
  const { results } = await db
    .prepare('SELECT * FROM orders WHERE sheets_synced = 0 ORDER BY id LIMIT ?')
    .bind(limit)
    .all<Record<string, unknown>>();
  return results.map(rowToOrder);
}

/** Moves an order to a new status only if it is still in the expected one. */
export async function setOrderStatus(db: D1Database, id: number, from: Status, to: Status): Promise<boolean> {
  const res = await db
    .prepare('UPDATE orders SET status = ?, sheets_synced = 0, updated_at = ? WHERE id = ? AND status = ?')
    .bind(to, nowIso(), id, from)
    .run();
  return (res.meta.changes ?? 0) > 0;
}

export async function setAdminMessage(db: D1Database, orderId: number, messageId: number): Promise<void> {
  await db.prepare('UPDATE orders SET admin_message_id = ? WHERE id = ?').bind(messageId, orderId).run();
}

export type RelayKind = 'in' | 'copy' | 'card';

export interface RelayRow {
  adminChatId: string;
  adminMessageId: number;
  chatId: number;
  orderId: number | null;
  kind: RelayKind;
}

export async function addRelay(db: D1Database, r: RelayRow): Promise<void> {
  await db
    .prepare(
      `INSERT OR REPLACE INTO relay (admin_chat_id, admin_message_id, chat_id, order_id, kind, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .bind(r.adminChatId, r.adminMessageId, r.chatId, r.orderId, r.kind, nowIso())
    .run();
}

export async function getRelay(
  db: D1Database,
  adminChatId: string,
  adminMessageId: number,
): Promise<{ chat_id: number; order_id: number | null } | null> {
  return db
    .prepare('SELECT chat_id, order_id FROM relay WHERE admin_chat_id = ? AND admin_message_id = ?')
    .bind(adminChatId, adminMessageId)
    .first<{ chat_id: number; order_id: number | null }>();
}

/** Messages the customer sent to the operators (one per message, not per copied file). */
export async function countInbound(db: D1Database, chatId: number, sinceIso: string): Promise<number> {
  const row = await db
    .prepare(`SELECT COUNT(*) AS n FROM relay WHERE chat_id = ? AND kind = 'in' AND created_at > ?`)
    .bind(chatId, sinceIso)
    .first<{ n: number }>();
  return row?.n ?? 0;
}

/** Drops the "how many?" step of a product card without touching the rest of the session. */
export async function clearSoftStep(db: D1Database, chatId: number): Promise<void> {
  await db
    .prepare(`UPDATE sessions SET step = NULL, updated_at = ? WHERE chat_id = ? AND step LIKE 'qty?:%'`)
    .bind(nowIso(), chatId)
    .run();
}

export type AlbumOutcome = 'sent' | 'refused';

/**
 * Every photo of an album arrives as its own update. The first one claims the album with
 * its outcome; later ones get that outcome back (null means "you are the first").
 */
export async function claimAlbum(
  db: D1Database,
  chatId: number,
  mediaGroup: string,
  outcome: AlbumOutcome,
): Promise<AlbumOutcome | null> {
  const key = `album:${chatId}:${mediaGroup}`;
  const res = await db
    .prepare('INSERT OR IGNORE INTO meta (key, value) VALUES (?, ?)')
    .bind(key, `${outcome}|${nowIso()}`)
    .run();
  if ((res.meta.changes ?? 0) > 0) return null;
  return (await getMeta(db, key))?.startsWith('refused|') ? 'refused' : 'sent';
}

/** Gives up a claim whose header never reached the operators, so the next photo posts it. */
export async function releaseAlbum(db: D1Database, chatId: number, mediaGroup: string): Promise<void> {
  await db.prepare('DELETE FROM meta WHERE key = ?').bind(`album:${chatId}:${mediaGroup}`).run();
}

/** Housekeeping for the cron: duplicate-update guard and old reply links. */
export async function pruneOld(db: D1Database): Promise<void> {
  const day = 86400_000;
  await db.batch([
    db.prepare('DELETE FROM processed_updates WHERE created_at < ?').bind(new Date(Date.now() - 7 * day).toISOString()),
    db.prepare('DELETE FROM relay WHERE created_at < ?').bind(new Date(Date.now() - 180 * day).toISOString()),
    db
      .prepare(`DELETE FROM meta WHERE key LIKE 'album:%' AND substr(value, instr(value, '|') + 1) < ?`)
      .bind(new Date(Date.now() - day).toISOString()),
  ]);
}

export async function getMeta(db: D1Database, key: string): Promise<string | null> {
  const row = await db.prepare('SELECT value FROM meta WHERE key = ?').bind(key).first<{ value: string }>();
  return row?.value ?? null;
}

export async function setMeta(db: D1Database, key: string, value: string): Promise<void> {
  await db
    .prepare('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
    .bind(key, value)
    .run();
}
