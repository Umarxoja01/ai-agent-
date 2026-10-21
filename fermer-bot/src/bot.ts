// ===================================================================
// FERMER BOT - SUHBAT (tugmalar + oddiy matn, AI yo'q)
// ===================================================================
// Har xabar: fermer topiladi/yaratiladi -> buyruq / menyu tugmasi /
// joriy qadam / erkin matn. Har yozuv avval tasdiq kartasi bilan
// ko'rsatiladi va faqat ✅ bosilganda saqlanadi. Karta tugmalari faqat
// o'sha kartaga va o'sha fermerga ishlaydi (eski karta - "eskirgan").
// ===================================================================

import type { Entry, Store } from './db.js';
import {
  EXPENSE_CATEGORIES, INCOME_CATEGORIES, money, normalize, parseAmount, parseDate, parseEntry, parseMilkAnswer,
  type Kind, type Parsed, type Unit,
} from './parse.js';
import { formatReport, PERIOD_LABELS, PERIODS, periodRange, summarize, toCsv, type Period } from './report.js';
import type { BotApi, InlineButton, InlineKeyboard, TgCallback, TgMessage, TgUpdate } from './telegram.js';
import { BTN, categoryLabel, dateLabel, EXAMPLES, EXPENSE_LABELS, INCOME_LABELS, KIND_LABELS, MAIN_KEYBOARD, TEXT } from './texts.js';

export interface Draft {
  kind: Kind;
  category: string | null;
  date: string;
  amount: number | null;
  qty: number | null;
  unit: Unit | null;
  unitPrice: number | null;
}
type Pending = Pick<Parsed, 'amount' | 'qty' | 'unit' | 'unitPrice' | 'date'>;

type State =
  | { step: 'farm_name' }
  | { step: 'milk' }
  | { step: 'kind'; partial: Pending; cardId?: number }
  | { step: 'category'; kind: 'income' | 'expense'; partial: Pending; cardId?: number }
  | { step: 'amount'; kind: 'income' | 'expense'; category: string; date?: string }
  | { step: 'confirm'; draft: Draft; cardId?: number }
  | { step: 'undo'; entryId: number; cardId?: number }
  | { step: 'delete_me'; cardId?: number };

export interface BotOptions {
  store: Store;
  api: BotApi;
  now?: () => Date;
  adminIds?: number[];
  log?: (line: string) => void;
  /** Bir daqiqada bir fermerdan qabul qilinadigan xabar soni. */
  rateLimit?: number;
}

const MAX_AMOUNT = 100_000_000_000;
const MAX_TEXT = 500;

/** Toshkent vaqti (UTC+5, yozgi vaqt yo'q) bo'yicha bugungi sana. */
export function tashkentToday(now: Date): string {
  return new Date(now.getTime() + 5 * 3_600_000).toISOString().slice(0, 10);
}

const inline = (rows: InlineButton[][]): InlineKeyboard => ({ inline_keyboard: rows });
const pairs = (buttons: InlineButton[]) => buttons.reduce<InlineButton[][]>((rows, b, i) => (i % 2 ? rows[rows.length - 1].push(b) : rows.push([b]), rows), []);

function categoryKeyboard(kind: 'income' | 'expense'): InlineKeyboard {
  const labels: Record<string, string> = kind === 'income' ? INCOME_LABELS : EXPENSE_LABELS;
  const categories: readonly string[] = kind === 'income' ? INCOME_CATEGORIES : EXPENSE_CATEGORIES;
  return inline([
    ...pairs(categories.map(c => ({ text: labels[c], callback_data: `c:${c}` }))),
    [{ text: kind === 'income' ? '↔️ Bu xarajat' : '↔️ Bu daromad', callback_data: 'sw' }, { text: '❌ Bekor', callback_data: 'no' }],
  ]);
}

const KIND_KEYBOARD = inline([
  [{ text: "🥛 Sut (litr)", callback_data: 'k:milk' }],
  [{ text: KIND_LABELS.income, callback_data: 'k:income' }, { text: KIND_LABELS.expense, callback_data: 'k:expense' }],
  [{ text: '❌ Bekor', callback_data: 'no' }],
]);

const REPORT_KEYBOARD = inline([PERIODS.map(p => ({ text: PERIOD_LABELS[p], callback_data: `r:${p}` }))]);

const liters = (n: number) => String(Math.round(n * 10) / 10).replace('.', ',');

export function describeEntry(d: Draft | Entry, today: string): string {
  const when = `Sana: ${dateLabel(d.date)}${d.date === today ? ' (bugun)' : ''}`;
  if (d.kind === 'milk') return [`${KIND_LABELS.milk}: ${liters(d.qty ?? 0)} litr`, when].join('\n');
  const head = `${KIND_LABELS[d.kind]} - ${categoryLabel(d.kind, d.category)}`;
  const unit = d.unit === 'l' ? 'litr' : d.unit === 'kg' ? 'kg' : 'bosh';
  const sum = d.qty && d.unitPrice
    ? `${liters(d.qty)} ${unit} × ${money(d.unitPrice)} = ${money(d.amount ?? 0)} so'm`
    : `Summa: ${money(d.amount ?? 0)} so'm${d.qty ? ` (${liters(d.qty)} ${unit})` : ''}`;
  return [head, sum, when].join('\n');
}

function confirmKeyboard(draft: Draft): InlineKeyboard {
  const rows: InlineButton[][] = [[{ text: '✅ Saqlash', callback_data: 'ok' }, { text: '❌ Bekor', callback_data: 'no' }]];
  if (draft.kind !== 'milk') rows.push([{ text: "🔁 Toifani o'zgartirish", callback_data: 'cat' }]);
  return inline(rows);
}

/** Menyu tugmasi (kirill yozuvi va emoji'siz yozilgan bo'lsa ham). */
function menuButton(text: string): keyof typeof BTN | undefined {
  const plain = normalize(text).replace(/[^a-z' ]/g, '').trim();
  const entries = Object.entries(BTN) as [keyof typeof BTN, string][];
  return entries.find(([, label]) => normalize(label).replace(/[^a-z' ]/g, '').trim() === plain)?.[0];
}

export function createBot(options: BotOptions) {
  const { store, api } = options;
  const now = options.now ?? (() => new Date());
  const log = options.log ?? (() => {});
  const admins = new Set(options.adminIds ?? []);
  const rateLimit = options.rateLimit ?? 30;
  const recent = new Map<number, number[]>();

  /** true = juda tez; birinchi oshganda bir marta ogohlantiradi. */
  function limited(farmerId: number): 'ok' | 'warn' | 'drop' {
    const t = now().getTime();
    const list = (recent.get(farmerId) ?? []).filter(x => t - x < 60_000);
    list.push(t);
    recent.set(farmerId, list);
    if (recent.size > 10_000) for (const [id, l] of recent) if (t - l[l.length - 1] > 60_000) recent.delete(id);
    if (list.length <= rateLimit) return 'ok';
    return list.length === rateLimit + 1 ? 'warn' : 'drop';
  }

  const today = () => tashkentToday(now());
  const state = (farmerId: number) => store.session<State>(farmerId);

  function monthLine(farmerId: number, kind: Kind): string {
    const range = periodRange('this_month', today());
    const s = summarize(store.entries(farmerId, range.from, range.to), range);
    if (kind === 'milk') return `Bu oy sog'ilgan: ${liters(s.milkLiters)} litr`;
    return `Bu oy: daromad ${money(s.income)}, xarajat ${money(s.expense)}, ${s.profit >= 0 ? 'foyda' : 'zarar'} ${money(Math.abs(s.profit))} so'm`;
  }

  async function showCard(farmerId: number, chatId: number, draft: Draft, editId?: number) {
    const text = `Tekshiring:\n\n${describeEntry(draft, today())}`;
    if (editId) {
      await api.editMessageText(chatId, editId, text, confirmKeyboard(draft));
      store.setSession(farmerId, { step: 'confirm', draft, cardId: editId });
    } else {
      const sent = await api.sendMessage(chatId, text, confirmKeyboard(draft));
      store.setSession(farmerId, { step: 'confirm', draft, cardId: sent.message_id });
    }
  }

  function draftFrom(kind: Kind, category: string | null, p: Pending): Draft {
    return { kind, category, date: p.date ?? today(), amount: p.amount ?? null, qty: p.qty ?? null, unit: p.unit ?? null, unitPrice: p.unitPrice ?? null };
  }

  async function askReport(chatId: number, farmerId: number, period: Period = 'this_month', editId?: number) {
    const range = periodRange(period, today());
    const text = formatReport(summarize(store.entries(farmerId, range.from, range.to), range), store.farmer(farmerId)?.farmName);
    if (editId) await api.editMessageText(chatId, editId, text, REPORT_KEYBOARD);
    else await api.sendMessage(chatId, text, REPORT_KEYBOARD);
  }

  async function startUndo(farmerId: number, chatId: number) {
    const last = store.lastEntry(farmerId);
    if (!last) { store.clearSession(farmerId); await api.sendMessage(chatId, TEXT.nothingToUndo); return; }
    const sent = await api.sendMessage(chatId, `${TEXT.undoAsk}\n\n${describeEntry(last, today())}`, inline([[
      { text: "🗑 Ha, o'chir", callback_data: `u:${last.id}` }, { text: "Yo'q", callback_data: 'no' },
    ]]));
    store.setSession(farmerId, { step: 'undo', entryId: last.id, cardId: sent.message_id });
  }

  /** Erkin matn: "900 ming yem", "kecha 80 l sog'dik", "o'tgan oy hisoboti"... */
  async function freeText(farmerId: number, chatId: number, text: string) {
    const plain = normalize(text);
    if (/hisob|foyda|zarar/.test(plain) && !/\d/.test(plain)) {
      store.clearSession(farmerId);
      await askReport(chatId, farmerId, /o'tgan oy/.test(plain) ? 'last_month' : /\byil/.test(plain) ? 'this_year' : 'this_month');
      return;
    }
    const p = parseEntry(text, today());
    if (p.dateError) { await api.sendMessage(chatId, `${p.dateError}. Sanani tekshirib qayta yozing.`); return; }
    if (p.kind === 'milk') {
      if (!p.qty || p.qty <= 0 || p.qty >= 100_000) { store.setSession(farmerId, { step: 'milk' }); await api.sendMessage(chatId, TEXT.askMilk); return; }
      await showCard(farmerId, chatId, draftFrom('milk', null, { qty: p.qty, unit: 'l', date: p.date }));
      return;
    }
    const partial: Pending = { amount: p.amount, qty: p.qty, unit: p.unit, unitPrice: p.unitPrice, date: p.date };
    if (p.amount !== undefined && (p.amount <= 0 || p.amount > MAX_AMOUNT)) { await api.sendMessage(chatId, TEXT.amountTooBig); return; }
    if (p.kind === 'income' || p.kind === 'expense') {
      const category = p.category ?? 'other';
      if (p.amount) { await showCard(farmerId, chatId, draftFrom(p.kind, category, partial)); return; }
      store.setSession(farmerId, { step: 'amount', kind: p.kind, category, ...(p.date ? { date: p.date } : {}) });
      await api.sendMessage(chatId, TEXT.askAmount(p.kind, category));
      return;
    }
    if (p.amount || p.qty) {
      const sent = await api.sendMessage(chatId, `${p.amount ? `${money(p.amount)}` : liters(p.qty!)} - bu nima?`, KIND_KEYBOARD);
      store.setSession(farmerId, { step: 'kind', partial, cardId: sent.message_id });
      return;
    }
    await api.sendMessage(chatId, `${TEXT.notUnderstood}${EXAMPLES}`, MAIN_KEYBOARD);
  }

  async function command(farmerId: number, chatId: number, cmd: string) {
    const farmer = store.farmer(farmerId)!;
    switch (cmd) {
      case 'start':
        if (!farmer.farmName) { store.setSession(farmerId, { step: 'farm_name' }); await api.sendMessage(chatId, TEXT.welcome(farmer.name), { remove_keyboard: true }); return; }
        store.clearSession(farmerId);
        await api.sendMessage(chatId, `${farmer.farmName}: xush kelibsiz!\n\n${TEXT.help()}`, MAIN_KEYBOARD);
        return;
      case 'help': case 'yordam':
        await api.sendMessage(chatId, TEXT.help(), MAIN_KEYBOARD); return;
      case 'bekor': case 'cancel':
        store.clearSession(farmerId); await api.sendMessage(chatId, TEXT.cancelled, MAIN_KEYBOARD); return;
      case 'hisobot': case 'report':
        store.clearSession(farmerId); await askReport(chatId, farmerId); return;
      case 'export': {
        store.clearSession(farmerId);
        const entries = store.entries(farmerId);
        if (!entries.length) { await api.sendMessage(chatId, TEXT.exportEmpty); return; }
        await api.sendDocument(chatId, `fermer-hisob-${today()}.csv`, toCsv(entries), `${entries.length} ta yozuv. Excel yoki Google Sheets'da oching.`);
        return;
      }
      case 'delete_me': {
        const sent = await api.sendMessage(chatId, TEXT.deleteMeAsk, inline([[{ text: "🗑 Ha, hammasini o'chir", callback_data: 'dm:yes' }, { text: "Yo'q", callback_data: 'no' }]]));
        store.setSession(farmerId, { step: 'delete_me', cardId: sent.message_id });
        return;
      }
      case 'stats': {
        // oddiy fermer uchun noma'lum buyruq - yordam
        if (!admins.has(farmerId)) { await api.sendMessage(chatId, TEXT.help(), MAIN_KEYBOARD); return; }
        const s = store.stats(new Date(now().getTime() - 7 * 86_400_000).toISOString());
        await api.sendMessage(chatId, `Fermerlar: ${s.farmers} (7 kunda faol: ${s.activeFarmers})\nYozuvlar: ${s.entries} (7 kunda: ${s.entriesSince})`);
        return;
      }
      default:
        await api.sendMessage(chatId, TEXT.help(), MAIN_KEYBOARD);
    }
  }

  async function onMessage(msg: TgMessage) {
    const from = msg.from;
    if (!from || from.is_bot) return;
    if (msg.chat.type !== 'private') {
      if (msg.text?.startsWith('/')) await api.sendMessage(msg.chat.id, TEXT.privateOnly);
      return;
    }
    const farmer = store.touchFarmer(from.id, msg.chat.id, [from.first_name, from.last_name].filter(Boolean).join(' '));
    const chatId = msg.chat.id;
    const rate = limited(farmer.id);
    if (rate !== 'ok') { if (rate === 'warn') await api.sendMessage(chatId, TEXT.tooFast); return; }
    if (typeof msg.text !== 'string') { await api.sendMessage(chatId, "Hozircha faqat matn tushunaman - yozib yuboring."); return; }
    const text = msg.text.trim().slice(0, MAX_TEXT);
    if (!text) return;

    const cmd = /^\/([a-z_]+)(@\w+)?(\s|$)/i.exec(text);
    if (cmd) { await command(farmer.id, chatId, cmd[1].toLowerCase()); return; }

    const current = state(farmer.id);
    if (!farmer.farmName) {
      if (current?.step !== 'farm_name') { await command(farmer.id, chatId, 'start'); return; }
      const name = text.replace(/[\u0000-\u001f]/g, '').trim();
      if (name.length < 2 || name.length > 60 || menuButton(name)) { await api.sendMessage(chatId, TEXT.farmNameBad); return; }
      store.setFarmName(farmer.id, name);
      store.clearSession(farmer.id);
      await api.sendMessage(chatId, TEXT.farmSaved(name), MAIN_KEYBOARD);
      return;
    }

    const button = menuButton(text);
    if (button) {
      store.clearSession(farmer.id);
      if (button === 'milk') { store.setSession(farmer.id, { step: 'milk' }); await api.sendMessage(chatId, TEXT.askMilk); return; }
      if (button === 'income' || button === 'expense') {
        const sent = await api.sendMessage(chatId, button === 'income' ? TEXT.chooseIncome : TEXT.chooseExpense, categoryKeyboard(button));
        store.setSession(farmer.id, { step: 'category', kind: button, partial: {}, cardId: sent.message_id });
        return;
      }
      if (button === 'report') { await askReport(chatId, farmer.id); return; }
      if (button === 'undo') { await startUndo(farmer.id, chatId); return; }
      await api.sendMessage(chatId, TEXT.help(), MAIN_KEYBOARD);
      return;
    }

    if (current?.step === 'milk') {
      const answer = parseMilkAnswer(text, today());
      if (answer.error) { await api.sendMessage(chatId, `${answer.error}. Qayta yozing.`); return; }
      if (!answer.qty) { await api.sendMessage(chatId, TEXT.milkBad); return; }
      await showCard(farmer.id, chatId, draftFrom('milk', null, { qty: answer.qty, unit: 'l', date: answer.date }));
      return;
    }
    if (current?.step === 'amount') {
      const amount = parseAmount(text);
      const when = parseDate(text, today());
      if (when.error) { await api.sendMessage(chatId, `${when.error}. Qayta yozing.`); return; }
      if (!amount.amount) { await api.sendMessage(chatId, TEXT.amountBad); return; }
      if (amount.amount <= 0 || amount.amount > MAX_AMOUNT) { await api.sendMessage(chatId, TEXT.amountTooBig); return; }
      await showCard(farmer.id, chatId, draftFrom(current.kind, current.category, { ...amount, date: when.date ?? current.date }));
      return;
    }
    // boshqa qadamda (karta kutilayotganda) yangi matn - yangi yozuv, eski karta eskiradi
    await freeText(farmer.id, chatId, text);
  }

  async function onCallback(cb: TgCallback) {
    const data = cb.data ?? '';
    const msg = cb.message;
    const farmer = store.farmer(cb.from.id);
    if (!msg || !farmer || msg.chat.type !== 'private') { await api.answerCallbackQuery(cb.id, TEXT.stale); return; }
    const chatId = msg.chat.id;
    store.touchFarmer(farmer.id, chatId, farmer.name);
    if (limited(farmer.id) !== 'ok') { await api.answerCallbackQuery(cb.id, TEXT.tooFast); return; }

    // hisobot tugmalari holatga bog'liq emas
    const report = /^r:(\w+)$/.exec(data);
    if (report && (PERIODS as string[]).includes(report[1])) {
      await api.answerCallbackQuery(cb.id);
      await askReport(chatId, farmer.id, report[1] as Period, msg.message_id);
      return;
    }

    const current = state(farmer.id);
    if (!current || !('cardId' in current) || current.cardId !== msg.message_id) {
      await api.answerCallbackQuery(cb.id, TEXT.stale);
      // tugmalarni olib tashlaymiz; juda eski xabarni tahrirlab bo'lmasa - mayli
      await api.editMessageText(chatId, msg.message_id, `${msg.text ?? ''}\n\n(${TEXT.stale})`.trim()).catch(() => {});
      return;
    }
    await api.answerCallbackQuery(cb.id);

    if (data === 'no') {
      store.clearSession(farmer.id);
      await api.editMessageText(chatId, msg.message_id, TEXT.cancelled);
      return;
    }
    if (current.step === 'confirm' && data === 'ok') {
      store.clearSession(farmer.id);
      const saved = store.addEntry(farmer.id, current.draft);
      await api.editMessageText(chatId, msg.message_id, `${TEXT.saved}\n\n${describeEntry(saved, today())}\n\n${monthLine(farmer.id, saved.kind)}`);
      return;
    }
    if (current.step === 'confirm' && data === 'cat' && current.draft.kind !== 'milk') {
      const { kind, amount, qty, unit, unitPrice, date } = current.draft;
      const partial: Pending = { date, ...(amount !== null ? { amount } : {}), ...(qty !== null ? { qty } : {}), ...(unit !== null ? { unit } : {}), ...(unitPrice !== null ? { unitPrice } : {}) };
      await api.editMessageText(chatId, msg.message_id, kind === 'income' ? TEXT.chooseIncome : TEXT.chooseExpense, categoryKeyboard(kind));
      store.setSession(farmer.id, { step: 'category', kind, partial, cardId: msg.message_id });
      return;
    }
    if (current.step === 'kind') {
      const kind = /^k:(milk|income|expense)$/.exec(data)?.[1] as Kind | undefined;
      if (!kind) return;
      if (kind === 'milk') {
        const qty = current.partial.unit === 'l' || !current.partial.unit ? current.partial.qty ?? current.partial.amount : undefined;
        if (!qty || qty >= 100_000) { store.setSession(farmer.id, { step: 'milk' }); await api.editMessageText(chatId, msg.message_id, TEXT.askMilk); return; }
        await showCard(farmer.id, chatId, draftFrom('milk', null, { qty, unit: 'l', date: current.partial.date }), msg.message_id);
        return;
      }
      await api.editMessageText(chatId, msg.message_id, kind === 'income' ? TEXT.chooseIncome : TEXT.chooseExpense, categoryKeyboard(kind));
      store.setSession(farmer.id, { step: 'category', kind, partial: current.partial, cardId: msg.message_id });
      return;
    }
    if (current.step === 'category' && data === 'sw') {
      const kind = current.kind === 'income' ? 'expense' : 'income';
      await api.editMessageText(chatId, msg.message_id, kind === 'income' ? TEXT.chooseIncome : TEXT.chooseExpense, categoryKeyboard(kind));
      store.setSession(farmer.id, { ...current, kind });
      return;
    }
    if (current.step === 'category') {
      const category = /^c:(\w+)$/.exec(data)?.[1];
      const allowed: readonly string[] = current.kind === 'income' ? INCOME_CATEGORIES : EXPENSE_CATEGORIES;
      if (!category || !allowed.includes(category)) return;
      if (current.partial.amount) { await showCard(farmer.id, chatId, draftFrom(current.kind, category, current.partial), msg.message_id); return; }
      store.setSession(farmer.id, { step: 'amount', kind: current.kind, category, ...(current.partial.date ? { date: current.partial.date } : {}) });
      await api.editMessageText(chatId, msg.message_id, TEXT.askAmount(current.kind, category));
      return;
    }
    if (current.step === 'undo' && data === `u:${current.entryId}`) {
      store.clearSession(farmer.id);
      const ok = store.deleteEntry(farmer.id, current.entryId);
      await api.editMessageText(chatId, msg.message_id, ok ? TEXT.undone : TEXT.nothingToUndo);
      return;
    }
    if (current.step === 'delete_me' && data === 'dm:yes') {
      const n = store.deleteFarmer(farmer.id);
      recent.delete(farmer.id);
      await api.editMessageText(chatId, msg.message_id, TEXT.deletedMe(n));
      await api.sendMessage(chatId, '👋', { remove_keyboard: true });
      return;
    }
  }

  async function handleUpdate(update: TgUpdate) {
    const chatId = update.message?.chat.id ?? update.callback_query?.message?.chat.id;
    try {
      if (update.message) await onMessage(update.message);
      else if (update.callback_query) await onCallback(update.callback_query);
    } catch (error) {
      // fermer yozgan matn logga tushmaydi - faqat xato
      log(`update ${update.update_id} xato: ${error instanceof Error ? error.message : String(error)}`);
      if (chatId) await api.sendMessage(chatId, TEXT.error).catch(() => {});
    }
  }

  return { handleUpdate };
}
