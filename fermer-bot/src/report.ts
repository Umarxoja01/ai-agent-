// ===================================================================
// FERMER BOT - HISOBOT (daromad, xarajat, foyda, sut)
// ===================================================================
// Hamma hisob shu yerda, kod bilan: summa, foyda, o'rtacha narx va litr
// tannarxi yozuvlardan qayta hisoblanadi, hech narsa taxmin qilinmaydi.
// ===================================================================

import type { Entry } from './db.js';
import { money } from './parse.js';
import { categoryLabel, MONTHS } from './texts.js';

export type Period = 'this_month' | 'last_month' | 'this_year';
export const PERIODS: Period[] = ['this_month', 'last_month', 'this_year'];
export const PERIOD_LABELS: Record<Period, string> = { this_month: 'Bu oy', last_month: "O'tgan oy", this_year: 'Bu yil' };

export interface Range { period: Period; from: string; to: string; title: string }

const lastDay = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();
const iso = (y: number, m: number, d: number) => `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;

/** Davr chegarasi; "bu oy" va "bu yil" bugun bilan tugaydi. */
export function periodRange(period: Period, today: string): Range {
  const [y, m, d] = today.split('-').map(Number);
  if (period === 'this_month') return { period, from: iso(y, m, 1), to: today, title: `${MONTHS[m - 1]} ${y} (1-${d})` };
  if (period === 'last_month') {
    const [py, pm] = m === 1 ? [y - 1, 12] : [y, m - 1];
    return { period, from: iso(py, pm, 1), to: iso(py, pm, lastDay(py, pm)), title: `${MONTHS[pm - 1]} ${py}` };
  }
  return { period, from: iso(y, 1, 1), to: today, title: `${y}-yil (1-yanvardan bugungacha)` };
}

export interface MonthRow { month: string; income: number; expense: number; profit: number; milkLiters: number }
export interface Summary {
  range: Range;
  entries: number;
  income: number;
  expense: number;
  profit: number;
  incomeByCategory: Record<string, number>;
  expenseByCategory: Record<string, number>;
  /** Sog'ilgan sut (litr) va nechta kunda yozilgan. */
  milkLiters: number;
  milkDays: number;
  /** Litri bilan yozilgan sut sotuvidan: jami litr va o'rtacha narx. */
  soldLiters: number;
  avgMilkPrice?: number;
  /** Mol sotib olishsiz xarajat / sog'ilgan litr. */
  operatingExpense: number;
  costPerLiter?: number;
  months?: MonthRow[];
}

const round1 = (n: number) => Math.round(n * 10) / 10;

export function summarize(all: Entry[], range: Range): Summary {
  const entries = all.filter(e => e.date >= range.from && e.date <= range.to);
  const incomeByCategory: Record<string, number> = {};
  const expenseByCategory: Record<string, number> = {};
  let income = 0, expense = 0, milkLiters = 0, soldLiters = 0, soldAmount = 0;
  const milkDates = new Set<string>();
  const months = new Map<string, MonthRow>();
  const month = (date: string) => {
    const key = date.slice(0, 7);
    if (!months.has(key)) months.set(key, { month: key, income: 0, expense: 0, profit: 0, milkLiters: 0 });
    return months.get(key)!;
  };
  for (const e of entries) {
    const row = month(e.date);
    if (e.kind === 'milk') {
      milkLiters += e.qty ?? 0;
      row.milkLiters += e.qty ?? 0;
      milkDates.add(e.date);
      continue;
    }
    const amount = e.amount ?? 0;
    const category = e.category ?? 'other';
    if (e.kind === 'income') {
      income += amount;
      row.income += amount;
      incomeByCategory[category] = (incomeByCategory[category] ?? 0) + amount;
      if (category === 'milk' && e.unit === 'l' && e.qty) { soldLiters += e.qty; soldAmount += amount; }
    } else {
      expense += amount;
      row.expense += amount;
      expenseByCategory[category] = (expenseByCategory[category] ?? 0) + amount;
    }
  }
  for (const row of months.values()) { row.profit = row.income - row.expense; row.milkLiters = round1(row.milkLiters); }
  const operatingExpense = expense - (expenseByCategory.animal ?? 0);
  return {
    range,
    entries: entries.length,
    income,
    expense,
    profit: income - expense,
    incomeByCategory,
    expenseByCategory,
    milkLiters: round1(milkLiters),
    milkDays: milkDates.size,
    soldLiters: round1(soldLiters),
    ...(soldLiters > 0 ? { avgMilkPrice: Math.round(soldAmount / soldLiters) } : {}),
    operatingExpense,
    ...(milkLiters > 0 && operatingExpense > 0 ? { costPerLiter: Math.round(operatingExpense / milkLiters) } : {}),
    ...(range.period === 'this_year' ? { months: [...months.values()].sort((a, b) => a.month.localeCompare(b.month)) } : {}),
  };
}

const liters = (n: number) => String(round1(n)).replace('.', ',');

function lines(kind: 'income' | 'expense', byCategory: Record<string, number>): string[] {
  return Object.entries(byCategory)
    .sort((a, b) => b[1] - a[1])
    .map(([category, sum]) => `   • ${categoryLabel(kind, category)}: ${money(sum)}`);
}

export function formatReport(s: Summary, farmName?: string | null): string {
  const out = [`📊 ${farmName ? `${farmName} - ` : ''}${s.range.title}`, ''];
  if (s.entries === 0) return [...out, "Bu davrda yozuv yo'q."].join('\n');
  out.push(`💰 Daromad: ${money(s.income)} so'm`, ...lines('income', s.incomeByCategory));
  out.push(`💸 Xarajat: ${money(s.expense)} so'm`, ...lines('expense', s.expenseByCategory));
  out.push('', s.profit >= 0 ? `✅ Foyda: ${money(s.profit)} so'm` : `🔻 Zarar: ${money(-s.profit)} so'm`);
  if (s.milkLiters > 0) {
    out.push('', `🥛 Sog'ilgan sut: ${liters(s.milkLiters)} litr (${s.milkDays} kun, kuniga o'rtacha ${liters(s.milkLiters / s.milkDays)} l)`);
  }
  if (s.avgMilkPrice !== undefined) out.push(`🥛 Sotilgan sut: ${liters(s.soldLiters)} litr, o'rtacha narx ${money(s.avgMilkPrice)} so'm/l`);
  if (s.costPerLiter !== undefined) {
    out.push(`💡 1 litr sutga taxminan ${money(s.costPerLiter)} so'm xarajat (mol sotib olishsiz xarajat / sog'ilgan litr)`);
  }
  if (s.months && s.months.length > 1) {
    out.push('', 'Oylar bo\'yicha (daromad / xarajat / foyda):');
    for (const m of s.months) out.push(`   ${MONTHS[Number(m.month.slice(5)) - 1]}: ${money(m.income)} / ${money(m.expense)} / ${money(m.profit)}`);
  }
  return out.join('\n');
}

/** Hamma yozuvlar CSV (Excel uchun ; ajratgich va BOM). */
export function toCsv(entries: Entry[]): string {
  const kind = { milk: "Sut sog'imi", income: 'Daromad', expense: 'Xarajat' } as const;
  const cell = (v: unknown) => {
    const s = v === null || v === undefined ? '' : String(v);
    // formula sifatida ochilmasin (=, +, -, @ bilan boshlangan izoh)
    const safe = /^[=+\-@]/.test(s) && !/^-?\d+([.,]\d+)?$/.test(s) ? `'${s}` : s;
    return /[";\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
  };
  const rows = [['Sana', 'Turi', 'Toifa', 'Miqdor', 'Birlik', 'Narx', 'Summa', 'Izoh']];
  for (const e of entries) {
    rows.push([e.date, kind[e.kind], e.kind === 'milk' ? '' : categoryLabel(e.kind, e.category), e.qty ?? '', e.unit ?? '', e.unitPrice ?? '', e.amount ?? '', e.note ?? ''].map(String));
  }
  return '﻿' + rows.map(r => r.map(cell).join(';')).join('\r\n') + '\r\n';
}
