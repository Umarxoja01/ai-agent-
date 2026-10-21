// ===================================================================
// FERMER BOT - MA'LUMOTLAR BAZASI (SQLite, node:sqlite)
// ===================================================================
// Har fermer = bitta Telegram foydalanuvchisi. Har bir so'rov farmer_id
// bilan cheklangan: bir fermer boshqasining yozuvini ko'ra olmaydi,
// o'chira olmaydi. Yozuv o'chirilganda deleted_at qo'yiladi (qaytarib
// bo'ladi); /delete_me esa fermerning hamma ma'lumotini butunlay o'chiradi.
// ===================================================================

import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { Kind, Unit } from './parse.js';

export interface Farmer {
  id: number;
  chatId: number;
  name: string;
  farmName: string | null;
  currency: string;
  plan: string;
  createdAt: string;
  lastSeenAt: string;
}

export interface EntryInput {
  kind: Kind;
  category: string | null;
  /** YYYY-MM-DD */
  date: string;
  amount: number | null;
  qty: number | null;
  unit: Unit | null;
  unitPrice: number | null;
  note?: string | null;
}
export interface Entry extends EntryInput {
  id: number;
  farmerId: number;
  createdAt: string;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS farmers (
  id INTEGER PRIMARY KEY,
  chat_id INTEGER NOT NULL,
  name TEXT NOT NULL DEFAULT '',
  farm_name TEXT,
  currency TEXT NOT NULL DEFAULT 'UZS',
  plan TEXT NOT NULL DEFAULT 'free',
  created_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  farmer_id INTEGER NOT NULL REFERENCES farmers(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('milk', 'income', 'expense')),
  category TEXT,
  date TEXT NOT NULL,
  amount INTEGER,
  qty REAL,
  unit TEXT,
  unit_price INTEGER,
  note TEXT,
  created_at TEXT NOT NULL,
  deleted_at TEXT
);
CREATE INDEX IF NOT EXISTS entries_farmer_date ON entries (farmer_id, date);
CREATE TABLE IF NOT EXISTS sessions (
  farmer_id INTEGER PRIMARY KEY REFERENCES farmers(id) ON DELETE CASCADE,
  state TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`;

type Row = Record<string, any>;

const toFarmer = (r: Row): Farmer => ({
  id: r.id, chatId: r.chat_id, name: r.name, farmName: r.farm_name, currency: r.currency, plan: r.plan, createdAt: r.created_at, lastSeenAt: r.last_seen_at,
});
const toEntry = (r: Row): Entry => ({
  id: r.id, farmerId: r.farmer_id, kind: r.kind, category: r.category, date: r.date, amount: r.amount, qty: r.qty, unit: r.unit, unitPrice: r.unit_price, note: r.note, createdAt: r.created_at,
});

export class Store {
  readonly db: DatabaseSync;
  private readonly now: () => Date;

  constructor(path: string, now: () => Date = () => new Date()) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.now = now;
    this.db.exec('PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
    if (path !== ':memory:') this.db.exec('PRAGMA journal_mode = WAL;');
    this.db.exec(SCHEMA);
  }

  private stamp(): string { return this.now().toISOString(); }

  close() { this.db.close(); }

  // ---------------- fermerlar ----------------

  farmer(id: number): Farmer | undefined {
    const row = this.db.prepare('SELECT * FROM farmers WHERE id = ?').get(id) as Row | undefined;
    return row ? toFarmer(row) : undefined;
  }

  /** Yangi fermerni yaratadi yoki chat/ism/oxirgi kirishni yangilaydi. */
  touchFarmer(id: number, chatId: number, name: string): Farmer {
    const at = this.stamp();
    this.db.prepare(`INSERT INTO farmers (id, chat_id, name, created_at, last_seen_at) VALUES (?, ?, ?, ?, ?)
      ON CONFLICT (id) DO UPDATE SET chat_id = excluded.chat_id, name = excluded.name, last_seen_at = excluded.last_seen_at`)
      .run(id, chatId, name.slice(0, 100), at, at);
    return this.farmer(id)!;
  }

  setFarmName(id: number, farmName: string) {
    this.db.prepare('UPDATE farmers SET farm_name = ? WHERE id = ?').run(farmName.slice(0, 60), id);
  }

  /** Fermer va uning hamma yozuvlari butunlay o'chadi (qaytmaydi). */
  deleteFarmer(id: number): number {
    const entries = Number((this.db.prepare('SELECT COUNT(*) AS n FROM entries WHERE farmer_id = ?').get(id) as Row).n);
    this.db.prepare('DELETE FROM entries WHERE farmer_id = ?').run(id);
    this.db.prepare('DELETE FROM sessions WHERE farmer_id = ?').run(id);
    this.db.prepare('DELETE FROM farmers WHERE id = ?').run(id);
    return entries;
  }

  // ---------------- yozuvlar ----------------

  addEntry(farmerId: number, e: EntryInput): Entry {
    const result = this.db.prepare(`INSERT INTO entries (farmer_id, kind, category, date, amount, qty, unit, unit_price, note, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(farmerId, e.kind, e.category, e.date, e.amount, e.qty, e.unit, e.unitPrice, e.note ?? null, this.stamp());
    return this.entry(farmerId, Number(result.lastInsertRowid))!;
  }

  entry(farmerId: number, id: number): Entry | undefined {
    const row = this.db.prepare('SELECT * FROM entries WHERE farmer_id = ? AND id = ? AND deleted_at IS NULL').get(farmerId, id) as Row | undefined;
    return row ? toEntry(row) : undefined;
  }

  /** Oxirgi kiritilgan (o'chirilmagan) yozuv. */
  lastEntry(farmerId: number): Entry | undefined {
    const row = this.db.prepare('SELECT * FROM entries WHERE farmer_id = ? AND deleted_at IS NULL ORDER BY id DESC LIMIT 1').get(farmerId) as Row | undefined;
    return row ? toEntry(row) : undefined;
  }

  /** Faqat shu fermerning yozuvi o'chadi; boshqa fermerning id'si bilan false. */
  deleteEntry(farmerId: number, id: number): boolean {
    const result = this.db.prepare('UPDATE entries SET deleted_at = ? WHERE farmer_id = ? AND id = ? AND deleted_at IS NULL').run(this.stamp(), farmerId, id);
    return Number(result.changes) === 1;
  }

  /** [from, to] oralig'idagi yozuvlar (ikkalasi ham kiradi), sana bo'yicha. */
  entries(farmerId: number, from = '0000-01-01', to = '9999-12-31'): Entry[] {
    return (this.db.prepare('SELECT * FROM entries WHERE farmer_id = ? AND deleted_at IS NULL AND date BETWEEN ? AND ? ORDER BY date, id').all(farmerId, from, to) as Row[]).map(toEntry);
  }

  // ---------------- suhbat holati ----------------

  session<T = Record<string, unknown>>(farmerId: number): T | undefined {
    const row = this.db.prepare('SELECT state FROM sessions WHERE farmer_id = ?').get(farmerId) as Row | undefined;
    if (!row) return undefined;
    try { return JSON.parse(row.state) as T; } catch { return undefined; }
  }

  setSession(farmerId: number, state: object) {
    this.db.prepare(`INSERT INTO sessions (farmer_id, state, updated_at) VALUES (?, ?, ?)
      ON CONFLICT (farmer_id) DO UPDATE SET state = excluded.state, updated_at = excluded.updated_at`)
      .run(farmerId, JSON.stringify(state), this.stamp());
  }

  clearSession(farmerId: number) {
    this.db.prepare('DELETE FROM sessions WHERE farmer_id = ?').run(farmerId);
  }

  // ---------------- xizmat ----------------

  getMeta(key: string): string | undefined {
    return (this.db.prepare('SELECT value FROM meta WHERE key = ?').get(key) as Row | undefined)?.value;
  }

  setMeta(key: string, value: string) {
    this.db.prepare('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value').run(key, value);
  }

  /** Admin uchun: faqat sonlar, hech kimning yozuvi yoki ismi emas. */
  stats(sinceIso: string): { farmers: number; activeFarmers: number; entries: number; entriesSince: number } {
    const one = (sql: string, ...args: string[]) => Number((this.db.prepare(sql).get(...args) as Row).n);
    return {
      farmers: one('SELECT COUNT(*) AS n FROM farmers'),
      activeFarmers: one('SELECT COUNT(*) AS n FROM farmers WHERE last_seen_at >= ?', sinceIso),
      entries: one('SELECT COUNT(*) AS n FROM entries WHERE deleted_at IS NULL'),
      entriesSince: one('SELECT COUNT(*) AS n FROM entries WHERE deleted_at IS NULL AND created_at >= ?', sinceIso),
    };
  }
}
