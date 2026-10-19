import type { Env } from './env';
import { setMeta } from './db';
import { ID_RE, nowIso } from './util';

const DELIMITER = /[,\r\n]/g;

/** Index of the next comma or line break at or after `from`. */
function nextDelimiter(s: string, from: number): number {
  DELIMITER.lastIndex = from;
  const m = DELIMITER.exec(s);
  return m ? m.index : s.length;
}

/**
 * RFC 4180 CSV: quoted fields, "" escapes, newlines inside quotes, CRLF, BOM.
 * Copies whole runs with slice(): the free plan gives a request 10 ms of CPU.
 */
export function parseCsv(text: string): string[][] {
  const s = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const rows: string[][] = [];
  let row: string[] = [];
  let i = 0;
  while (i < s.length) {
    let field = '';
    if (s[i] === '"') {
      let j = i + 1;
      for (;;) {
        const q = s.indexOf('"', j);
        if (q < 0) {
          field += s.slice(j);
          j = s.length;
          break;
        }
        field += s.slice(j, q);
        if (s[q + 1] === '"') {
          field += '"';
          j = q + 2;
        } else {
          j = q + 1;
          break;
        }
      }
      const end = nextDelimiter(s, j);
      field += s.slice(j, end);
      i = end;
    } else {
      const end = nextDelimiter(s, i);
      field = s.slice(i, end);
      i = end;
    }
    row.push(field);
    if (i >= s.length) break;
    if (s[i] === ',') {
      i++;
      if (i === s.length) row.push('');
      continue;
    }
    i += s[i] === '\r' && s[i + 1] === '\n' ? 2 : 1;
    rows.push(row);
    row = [];
  }
  if (row.length) rows.push(row);
  return rows.filter((r) => r.some((f) => f.trim() !== ''));
}

export interface CatalogRow {
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
}

const TEXT_LIMITS: Record<string, number> = {
  category_uz: 80,
  category_ru: 80,
  name: 80,
  name_ru: 80,
  maker: 80,
  form_uz: 200,
  form_ru: 200,
  ingredient: 200,
  description_uz: 1500,
  description_ru: 1500,
  dose_uz: 800,
  dose_ru: 800,
  unit_uz: 20,
  unit_ru: 20,
};

const TRUE = new Set(['1', 'ha', 'xa', 'yes', 'y', 'true', 'да', '+', 'bor', 'есть']);
const FALSE = new Set(['0', "yo'q", 'yoʻq', 'yo‘q', 'yo’q', 'yoq', 'no', 'n', 'false', 'нет', '-']);

function parseBool(value: string | undefined, fallback: number): number | 'bad' {
  const v = (value ?? '').trim().toLowerCase();
  if (!v) return fallback;
  if (TRUE.has(v)) return 1;
  if (FALSE.has(v)) return 0;
  return 'bad';
}

/** "125 000", "125 000 so'm", "125,000", "125000.00" -> 125000; empty or 0 -> null (price on request). */
function parsePrice(value: string | undefined): number | null | 'bad' {
  let v = (value ?? '')
    .toLowerCase()
    .replace(/so['ʻʼ’‘`]?m|сум|sum|uzs/g, '')
    .trim();
  if (!v) return null;
  v = v.replace(/[.,]0{1,2}$/, '');
  const compact = v.replace(/[\s  ]/g, '');
  if (!/^\d+$/.test(compact) && !/^\d{1,3}([.,]\d{3})+$/.test(compact)) return 'bad';
  const digits = compact.replace(/[.,]/g, '');
  if (digits.length > 12) return 'bad';
  return Number(digits) || null;
}

export interface ParseResult {
  rows: CatalogRow[];
  errors: string[];
}

/** Validates the sheet. Bad rows are skipped and reported by their sheet line number. */
export function parseCatalog(csv: string): ParseResult {
  const table = parseCsv(csv);
  const errors: string[] = [];
  if (!table.length) return { rows: [], errors: ['CSV boʻsh'] };
  const header = table[0]!.map((h) => h.trim().toLowerCase());
  for (const required of ['id', 'name', 'category']) {
    if (!header.includes(required)) errors.push(`sarlavhada "${required}" ustuni yoʻq`);
  }
  if (errors.length) return { rows: [], errors };

  const rows: CatalogRow[] = [];
  const seen = new Set<string>();
  table.slice(1).forEach((cells, idx) => {
    const line = idx + 2;
    const get = (name: string): string => {
      const i = header.indexOf(name);
      return i >= 0 ? (cells[i] ?? '').trim() : '';
    };
    const text = (name: string): string | null => {
      const v = get(name).replace(/\r\n?/g, '\n');
      return v ? v.slice(0, TEXT_LIMITS[name] ?? 200) : null;
    };
    const id = get('id').toLowerCase();
    const category = get('category').toLowerCase();
    const name = get('name');
    if (!ID_RE.test(id)) return errors.push(`${line}-qator: id "${id}" notoʻgʻri (faqat a-z, 0-9, _ va -)`);
    if (seen.has(id)) return errors.push(`${line}-qator: id "${id}" takrorlangan`);
    if (!ID_RE.test(category)) return errors.push(`${line}-qator (${id}): category "${category}" notoʻgʻri`);
    if (!name) return errors.push(`${line}-qator (${id}): name boʻsh`);
    const price = parsePrice(get('price'));
    if (price === 'bad') return errors.push(`${line}-qator (${id}): narx "${get('price')}" tushunarsiz`);
    const inStock = parseBool(get('in_stock'), 1);
    const active = parseBool(get('active'), 1);
    const doseVerified = parseBool(get('dose_verified'), 0);
    if (inStock === 'bad' || active === 'bad' || doseVerified === 'bad') {
      return errors.push(`${line}-qator (${id}): in_stock/active/dose_verified faqat "ha" yoki "yoʻq" boʻlsin`);
    }
    let photoUrl = get('photo_url') || null;
    if (photoUrl && !/^https:\/\/[^\s"'<>]+$/.test(photoUrl)) {
      errors.push(`${line}-qator (${id}): photo_url https:// bilan boshlanishi kerak — eʼtiborsiz qoldirildi`);
      photoUrl = null;
    }
    const alternatives =
      get('alternatives')
        .toLowerCase()
        .split(/[,;\s]+/)
        .filter((a) => ID_RE.test(a) && a !== id)
        .join(',') || null;
    const sort = Number.parseInt(get('sort'), 10);
    seen.add(id);
    rows.push({
      id,
      sort: Number.isFinite(sort) ? sort : line * 10,
      category,
      category_uz: text('category_uz'),
      category_ru: text('category_ru'),
      name: name.slice(0, TEXT_LIMITS.name),
      name_ru: text('name_ru'),
      maker: text('maker'),
      form_uz: text('form_uz'),
      form_ru: text('form_ru'),
      ingredient: text('ingredient'),
      description_uz: text('description_uz'),
      description_ru: text('description_ru'),
      dose_uz: text('dose_uz'),
      dose_ru: text('dose_ru'),
      dose_verified: doseVerified,
      unit_uz: text('unit_uz'),
      unit_ru: text('unit_ru'),
      price,
      in_stock: inStock,
      active,
      photo_url: photoUrl,
      alternatives,
    });
  });
  if (rows.length > 500) {
    errors.push(`${rows.length - 500} ta qator chegaradan (500) oshib ketdi`);
    rows.length = 500;
  }
  return { rows, errors };
}

const COLUMNS: (keyof CatalogRow)[] = [
  'id',
  'sort',
  'category',
  'category_uz',
  'category_ru',
  'name',
  'name_ru',
  'maker',
  'form_uz',
  'form_ru',
  'ingredient',
  'description_uz',
  'description_ru',
  'dose_uz',
  'dose_ru',
  'dose_verified',
  'unit_uz',
  'unit_ru',
  'price',
  'in_stock',
  'active',
  'photo_url',
  'alternatives',
];

/**
 * Replaces the catalog with the sheet in one transaction: rows are upserted, products
 * missing from the sheet are deactivated (never deleted, past orders keep their snapshot).
 */
export async function applyCatalog(db: D1Database, rows: CatalogRow[]): Promise<void> {
  const now = nowIso();
  const payload = JSON.stringify(rows);
  const updates = COLUMNS.filter((c) => c !== 'id')
    .map((c) => `${c} = excluded.${c}`)
    .join(', ');
  await db.batch([
    db
      .prepare(
        `INSERT INTO products (${COLUMNS.join(', ')}, updated_at)
         SELECT ${COLUMNS.map((c) => `json_extract(value, '$.${c}')`).join(', ')}, ?2
         FROM json_each(?1) WHERE true
         ON CONFLICT(id) DO UPDATE SET ${updates}, updated_at = excluded.updated_at`,
      )
      .bind(payload, now),
    db
      .prepare(
        `UPDATE products SET active = 0, updated_at = ?2
         WHERE active = 1 AND id NOT IN (SELECT json_extract(value, '$.id') FROM json_each(?1))`,
      )
      .bind(payload, now),
  ]);
}

export interface SyncReport {
  ok: boolean;
  total: number;
  active: number;
  errors: string[];
}

export async function syncCatalog(env: Env): Promise<SyncReport> {
  const url = env.CATALOG_CSV_URL;
  if (!url) return { ok: false, total: 0, active: 0, errors: ['CATALOG_CSV_URL sozlanmagan'] };
  let csv: string;
  try {
    const res = await fetch(url, { redirect: 'follow', headers: { Accept: 'text/csv' } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    csv = await res.text();
  } catch (err) {
    return { ok: false, total: 0, active: 0, errors: [`CSV yuklanmadi: ${err instanceof Error ? err.message : err}`] };
  }
  // Keeps parsing within the free plan's CPU time and the json_each payload well under D1's value limit.
  if (csv.length > 300_000) return { ok: false, total: 0, active: 0, errors: ['CSV 300 KB dan katta — tavsiflarni qisqartiring'] };
  if (/^\s*<(!doctype|html)/i.test(csv)) {
    return { ok: false, total: 0, active: 0, errors: ['CSV oʻrniga HTML keldi — jadval "Publish to web → CSV" qilinganmi?'] };
  }
  const { rows, errors } = parseCatalog(csv);
  // An empty or broken sheet must not wipe the live catalog.
  if (!rows.length) return { ok: false, total: 0, active: 0, errors: errors.length ? errors : ['yaroqli qator yoʻq'] };
  await applyCatalog(env.DB, rows);
  await setMeta(env.DB, 'catalog_synced_at', nowIso());
  return { ok: true, total: rows.length, active: rows.filter((r) => r.active).length, errors };
}
