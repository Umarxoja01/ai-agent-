// ===================================================================
// FERMER BOT - O'ZBEKCHA MATNNI TUSHUNISH (AI yo'q, faqat qoidalar)
// ===================================================================
// Fermer "900 ming yem", "120 litr sut sotdim, litri 6000", "kecha 80 l
// sog'dik" deb yozadi; bu yerda raqam, birlik, narx, sana va yozuv turi
// qoida bilan ajratiladi. Natija har doim tasdiq kartasi bilan fermerga
// ko'rsatiladi: noaniq bo'lsa taxmin qilinmaydi, so'raladi.
// Lotin va kirill yozuvi ikkalasi tushuniladi.
// ===================================================================

export type Kind = 'milk' | 'income' | 'expense';

export const INCOME_CATEGORIES = ['milk', 'animal', 'meat', 'manure', 'other'] as const;
export const EXPENSE_CATEGORIES = ['feed', 'vet', 'labor', 'transport', 'utilities', 'animal', 'other'] as const;
export type IncomeCategory = typeof INCOME_CATEGORIES[number];
export type ExpenseCategory = typeof EXPENSE_CATEGORIES[number];
export type Unit = 'l' | 'kg' | 'bosh';

export interface Amount {
  /** Jami summa, so'm (butun). */
  amount?: number;
  qty?: number;
  unit?: Unit;
  unitPrice?: number;
}
export interface Parsed extends Amount {
  kind?: Kind;
  category?: string;
  /** YYYY-MM-DD; berilmasa - bugun. */
  date?: string;
  dateError?: string;
}

const CYRILLIC: Record<string, string> = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'yo', ж: 'j', з: 'z', и: 'i', й: 'y', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'x', ц: 's', ч: 'ch', ш: 'sh', щ: 'sh', ъ: "'", ы: 'i', ь: '', э: 'e', ю: 'yu', я: 'ya', ў: "o'", қ: 'q', ғ: "g'", ҳ: 'h',
};

/** Kichik harf, lotin yozuvi, bitta turdagi apostrof, bitta bo'shliq. */
export function normalize(text: string): string {
  const lower = text.toLowerCase()
    // so'z boshidagi е = ye (ем -> yem, етти -> yetti)
    .replace(/(^|[^a-zа-яёўқғҳ'ʻʼ’‘`])е/g, '$1ye');
  return lower.split('').map(ch => CYRILLIC[ch] ?? ch).join('')
    .replace(/[`ʻʼ’‘´]/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

const MULTIPLIERS: Array<[RegExp, number]> = [
  [/^(mlrd|milliard)/, 1_000_000_000],
  [/^(mln|million|millon|m\b)/, 1_000_000],
  [/^(ming|tisyach|tysyach|tыс|k\b)/, 1_000],
];

export interface Num { value: number; before: string; after: string }

/**
 * Matndagi raqamlar: "720 000" -> 720000, "1,2 mln" -> 1200000, "900 ming"
 * -> 900000, "6 mingdan" -> 6000 (after = "dan..."), "85,5" -> 85.5,
 * "720.000" -> 720000. Sana ko'rinishidagi "25.10" ni avval olib tashlang.
 */
export function numbers(text: string): Num[] {
  const s = normalize(text);
  const tokens = [...s.matchAll(/\d+(?:[.,]\d+)*/g)].map(m => ({ raw: m[0], start: m.index!, end: m.index! + m[0].length }));
  // "1 200 000": 1-3 xonali boshlanish + bo'shliq bilan 3 xonali guruhlar
  const merged: typeof tokens = [];
  for (const t of tokens) {
    const prev = merged.at(-1);
    if (prev && /^\d{3}$/.test(t.raw) && s.slice(prev.end, t.start) === ' ' && /^\d{1,3}( \d{3})*$/.test(prev.raw)) {
      prev.raw += ` ${t.raw}`;
      prev.end = t.end;
      continue;
    }
    merged.push({ ...t });
  }
  return merged.map(t => {
    let after = s.slice(t.end).trimStart();
    const mult = MULTIPLIERS.map(([re, factor]) => ({ hit: re.exec(after), factor })).find(x => x.hit);
    const raw = t.raw.replace(/ /g, '');
    const seps = raw.match(/[.,]/g) ?? [];
    let value: number;
    if (seps.length > 1) value = Number(raw.replace(/[.,]/g, ''));
    else if (seps.length === 1) {
      const [whole, frac] = raw.split(/[.,]/);
      // "720.000" minglik ajratgich; "1,2 mln" yoki "85,5" kasr
      value = frac.length === 3 && !mult ? Number(whole + frac) : Number(`${whole}.${frac}`);
    } else value = Number(raw);
    if (mult) { value *= mult.factor; after = after.slice(mult.hit![0].length).trimStart(); }
    return { value: Math.round(value * 100) / 100, before: s.slice(Math.max(0, t.start - 12), t.start), after: after.slice(0, 24) };
  });
}

export function addDays(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
}

// "15.10", "15/10/2026"; "1.5 mln", "12.5 litr", "1.200.000" sana emas
const DATE_RE = /(?<![\d.,])(\d{1,2})[./](\d{1,2})(?:[./](\d{2,4}))?(?![\d.,]|\s*(?:mlrd|milliard|mln|million|millon|m\b|ming|k\b|litr|liter|l\b|kg|kilo|bosh|ta\b|dona|so'm|sum))/g;

/** Kun 1-31 va oy 1-12 bo'lgan sana ko'rinishlari ("85.5" sana emas). */
function dateMatches(s: string): RegExpMatchArray[] {
  return [...s.matchAll(DATE_RE)].filter(m => {
    const [d, mo] = [Number(m[1]), Number(m[2])];
    return d >= 1 && d <= 31 && mo >= 1 && mo <= 12;
  });
}

/** "kecha", "o'tgan kuni", "25.10", "25.10.2026" -> sana (Toshkent bo'yicha bugundan). */
export function parseDate(text: string, today: string): { date?: string; error?: string } {
  const s = normalize(text);
  if (/\bkecha\b/.test(s)) return { date: addDays(today, -1) };
  if (/\bo'tgan kuni\b|\bavvalgi kuni\b/.test(s)) return { date: addDays(today, -2) };
  const m = dateMatches(s)[0];
  if (!m) return {};
  const [d, mo] = [Number(m[1]), Number(m[2])];
  let y = m[3] ? Number(m[3]) : Number(today.slice(0, 4));
  if (y < 100) y += 2000;
  const date = `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  if (new Date(`${date}T00:00:00Z`).getUTCDate() !== d) return { error: `Bunday sana yo'q: ${m[0]}` };
  if (date > today) return { error: `Sana kelajakda: ${m[0]}` };
  if (y < 2000) return { error: `Sana juda eski: ${m[0]}` };
  return { date };
}

function withoutDates(text: string): string {
  let s = normalize(text);
  for (const m of dateMatches(s).reverse()) s = `${s.slice(0, m.index!)} ${s.slice(m.index! + m[0].length)}`;
  return s;
}

const UNIT_RE = /^(litr|liter|l\b|kg\b|kilo|bosh|ta\b|dona)/;
const unitOf = (word: string): Unit => /^(litr|liter|l\b)/.test(word) ? 'l' : /^(kg|kilo)/.test(word) ? 'kg' : 'bosh';
const PRICE_BEFORE = /(litri|litrini|litrga|kilosi|kilosini|boshi|donasi|narxi|narx|x|\*|×)\s*$/;
const PRICE_AFTER = /^(dan\b|so'mdan|sumdan|so'm dan)/;

/**
 * Summani ajratadi: "900 ming" -> 900000; "120 litr, litri 6000" yoki
 * "120 l x 6000" yoki "120 litrni 6 mingdan" -> 120 x 6000 = 720000 (bu
 * holda summani har doim kod hisoblaydi). "120 6000" kabi noaniq juftlik
 * uchun hech narsa qaytmaydi - bot qayta so'raydi.
 */
export function parseAmount(text: string): Amount {
  const nums = numbers(withoutDates(text));
  const withUnit = nums.find(n => UNIT_RE.test(n.after));
  const priced = nums.find(n => n !== withUnit && (PRICE_AFTER.test(n.after) || PRICE_BEFORE.test(n.before)));
  if (withUnit && priced) {
    return { qty: withUnit.value, unit: unitOf(withUnit.after), unitPrice: Math.round(priced.value), amount: Math.round(withUnit.value * priced.value) };
  }
  const plain = nums.filter(n => n !== withUnit);
  if (plain.length === 1) return { amount: Math.round(plain[0].value), ...(withUnit ? { qty: withUnit.value, unit: unitOf(withUnit.after) } : {}) };
  return withUnit ? { qty: withUnit.value, unit: unitOf(withUnit.after) } : {};
}

/** Faqat litr: "85", "85 l", "85,5 litr". */
export function parseLiters(text: string): number | undefined {
  const nums = numbers(text);
  if (nums.length !== 1) return undefined;
  const v = nums[0].value;
  return v > 0 && v < 100_000 ? v : undefined;
}

/**
 * "Necha litr?" savoliga javob: "85", "85,5", "kecha 80", "15.10 80".
 * Bitta raqam bo'lsa - u litr ("12.5" ham); aks holda sana olib tashlanadi.
 */
export function parseMilkAnswer(text: string, today: string): { qty?: number; date?: string; error?: string } {
  const relative = /\b(kecha|o'tgan kuni|avvalgi kuni)\b/.test(normalize(text));
  const raw = numbers(text);
  // "kecha 12.5" yoki yolg'iz "12.5": raqam litr, sana so'zdan yoki bugun
  const byWord = relative || raw.length === 1;
  const nums = byWord ? raw : numbers(withoutDates(text));
  const when = byWord && !relative ? {} : parseDate(text, today);
  if (when.error) return { error: when.error };
  if (nums.length !== 1 || nums[0].value <= 0 || nums[0].value >= 100_000) return {};
  return { qty: nums[0].value, ...(when.date ? { date: when.date } : {}) };
}

const MILK_WORD = /\bsut/;
const MILKED = /sog'd|sog'il|sog'im|sog'ib|sog'amiz|sog'yap/;
const SOLD = /sotd|sotil|topshird|topshiril|pul oldim|pul tushdi|pul keldi|to'lov oldim|to'lov keldi|tushum|daromad|kirim/;
const SPENT = /oldim|olindi|sotib old|xarid|to'lad|to'lan|berdim|ketdi|sarfl|xarajat|chiqim/;

const EXPENSE_WORDS: Array<[ExpenseCategory, RegExp]> = [
  // "sigir sotib oldim", "2 ta buzoq oldim" - lekin "sigir uchun yem oldim" emas
  ['animal', /(sigir|buzoq|\bmol\b|tana|g'unajin|qo'y|echki|buqa|ho'kiz)\w*\s+(sotib old|oldim|olindi|xarid)/],
  ['feed', /\byem|omuxta|xashak|pichan|\bsena?\b|\bseno\b|silos|kepak|arpa|bug'doy|makka|jo'xori|shrot|kunjara|premiks|\btuz\b/],
  ['vet', /veterinar|\bvet\b|dori|ukol|emla|vaksina|vitamin|davola|shprits/],
  ['labor', /ish haqi|ishchi|cho'pon|oylik|mardikor/],
  ['transport', /benzin|yoqilg'i|solyarka|dizel|transport|mashina|\bkira\b|tashi/],
  ['utilities', /svet|elektr|\btok\b|\bgaz\b|\bsuv\b|kommunal/],
];
const INCOME_WORDS: Array<[IncomeCategory, RegExp]> = [
  ['milk', MILK_WORD],
  ['meat', /go'sht/],
  ['manure', /go'ng|o'g'it/],
  ['animal', /sigir|buzoq|\bmol\b|tana|g'unajin|qo'y|echki|buqa|ho'kiz/],
];

/**
 * Erkin matndan yozuvni taxmin qiladi. Hech narsani saqlamaydi: natija
 * fermerga tasdiq kartasi sifatida ko'rsatiladi.
 */
export function parseEntry(text: string, today: string): Parsed {
  const s = normalize(text);
  const result: Parsed = {};
  const when = parseDate(text, today);
  if (when.date) result.date = when.date;
  if (when.error) result.dateError = when.error;
  const amount = parseAmount(text);

  const sold = SOLD.test(s);
  if (MILKED.test(s) && !sold && amount.unit === 'l' && amount.unitPrice === undefined) {
    return { ...result, kind: 'milk', qty: amount.qty, unit: 'l' };
  }
  Object.assign(result, amount);
  if (sold) {
    result.kind = 'income';
    result.category = INCOME_WORDS.find(([, re]) => re.test(s))?.[0] ?? 'other';
  } else if (SPENT.test(s) || EXPENSE_WORDS.some(([, re]) => re.test(s))) {
    result.kind = 'expense';
    result.category = EXPENSE_WORDS.find(([, re]) => re.test(s))?.[0] ?? 'other';
  } else if (amount.unit === 'l' && amount.amount === undefined && MILK_WORD.test(s)) {
    result.kind = 'milk';
  }
  return result;
}

/** 1234567 -> "1 234 567". */
export function money(n: number): string {
  const sign = n < 0 ? '−' : '';
  return sign + Math.round(Math.abs(n)).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
}
