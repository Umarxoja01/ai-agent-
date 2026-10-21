import { describe, expect, it } from 'vitest';
import { Store } from '../src/db.js';
import { formatReport, periodRange, summarize, toCsv } from '../src/report.js';

const TODAY = '2026-10-21';

function seed() {
  const store = new Store(':memory:');
  store.touchFarmer(1, 1, 'Ali');
  const add = (e: Partial<Parameters<Store['addEntry']>[1]>) => store.addEntry(1, { kind: 'expense', category: 'other', date: TODAY, amount: null, qty: null, unit: null, unitPrice: null, ...e });
  add({ kind: 'milk', qty: 80, unit: 'l', date: '2026-10-01' });
  add({ kind: 'milk', qty: 90.5, unit: 'l', date: '2026-10-02' });
  add({ kind: 'income', category: 'milk', qty: 120, unit: 'l', unitPrice: 6000, amount: 720_000, date: '2026-10-02' });
  add({ kind: 'income', category: 'milk', amount: 300_000, date: '2026-10-03' });
  add({ kind: 'expense', category: 'feed', amount: 900_000, date: '2026-10-05' });
  add({ kind: 'expense', category: 'animal', amount: 15_000_000, date: '2026-10-06' });
  add({ kind: 'income', category: 'animal', amount: 6_000_000, date: '2026-09-10' });
  add({ kind: 'expense', category: 'vet', amount: 100_000, date: '2026-09-11' });
  return store;
}

describe('periodRange', () => {
  it('this month ends today, last month is a whole month, January wraps the year', () => {
    expect(periodRange('this_month', TODAY)).toMatchObject({ from: '2026-10-01', to: '2026-10-21' });
    expect(periodRange('last_month', TODAY)).toMatchObject({ from: '2026-09-01', to: '2026-09-30' });
    expect(periodRange('last_month', '2026-01-15')).toMatchObject({ from: '2025-12-01', to: '2025-12-31' });
    expect(periodRange('last_month', '2028-03-02')).toMatchObject({ from: '2028-02-01', to: '2028-02-29' });
    expect(periodRange('this_year', TODAY)).toMatchObject({ from: '2026-01-01', to: '2026-10-21' });
  });
});

describe('summarize', () => {
  it('totals, profit, milk litres, average price and cost per litre are computed by code', () => {
    const store = seed();
    const s = summarize(store.entries(1), periodRange('this_month', TODAY));
    expect(s).toMatchObject({
      entries: 6,
      income: 1_020_000,
      expense: 15_900_000,
      profit: -14_880_000,
      incomeByCategory: { milk: 1_020_000 },
      expenseByCategory: { feed: 900_000, animal: 15_000_000 },
      milkLiters: 170.5,
      milkDays: 2,
      soldLiters: 120,
      avgMilkPrice: 6000,
      operatingExpense: 900_000,
      costPerLiter: 5279,
    });
    expect(s.months).toBeUndefined();
    const text = formatReport(s, 'Baraka');
    expect(text).toContain("💰 Daromad: 1 020 000 so'm");
    expect(text).toContain("🔻 Zarar: 14 880 000 so'm");
    expect(text).toContain("Sog'ilgan sut: 170,5 litr (2 kun, kuniga o'rtacha 85,3 l)");
    expect(text).toContain("o'rtacha narx 6 000 so'm/l");
    expect(text).toContain("1 litr sutga taxminan 5 279 so'm");
  });

  it('the year has a month table; an empty period says so', () => {
    const store = seed();
    const year = summarize(store.entries(1), periodRange('this_year', TODAY));
    expect(year.months).toEqual([
      { month: '2026-09', income: 6_000_000, expense: 100_000, profit: 5_900_000, milkLiters: 0 },
      { month: '2026-10', income: 1_020_000, expense: 15_900_000, profit: -14_880_000, milkLiters: 170.5 },
    ]);
    expect(formatReport(year)).toContain('Sentabr: 6 000 000 / 100 000 / 5 900 000');
    const empty = summarize(store.entries(1), periodRange('last_month', '2026-03-10'));
    expect(formatReport(empty)).toContain("Bu davrda yozuv yo'q.");
  });
});

describe('toCsv', () => {
  it('Excel-friendly: BOM, ; separator, quoted text, no formulas', () => {
    const store = seed();
    store.addEntry(1, { kind: 'expense', category: 'other', date: TODAY, amount: 5000, qty: null, unit: null, unitPrice: null, note: '=HYPERLINK("x");1' });
    const csv = toCsv(store.entries(1));
    expect(csv.startsWith('﻿Sana;Turi;Toifa;Miqdor;Birlik;Narx;Summa;Izoh\r\n')).toBe(true);
    expect(csv).toContain("2026-10-02;Daromad;Sut sotuvi;120;l;6000;720000;\r\n");
    expect(csv).toContain(`"'=HYPERLINK(""x"");1"`);
  });
});
