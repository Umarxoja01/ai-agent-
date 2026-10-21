import { describe, expect, it } from 'vitest';
import { addDays, money, normalize, numbers, parseAmount, parseDate, parseEntry, parseLiters, parseMilkAnswer } from '../src/parse.js';

const TODAY = '2026-10-21';

describe('normalize', () => {
  it('turns Cyrillic Uzbek into Latin and unifies apostrophes', () => {
    expect(normalize('Ем учун 900 минг')).toBe('yem uchun 900 ming');
    expect(normalize('Сут СОТДИМ')).toBe('sut sotdim');
    expect(normalize('ўғит, қўй, ҳа')).toBe("o'g'it, qo'y, ha");
    expect(normalize("so‘m   sog`dik")).toBe("so'm sog'dik");
  });
});

describe('numbers', () => {
  it('reads multipliers, thousand separators and decimals', () => {
    expect(numbers('900 ming').map(n => n.value)).toEqual([900_000]);
    expect(numbers('1,2 mln').map(n => n.value)).toEqual([1_200_000]);
    expect(numbers('1.5mln').map(n => n.value)).toEqual([1_500_000]);
    expect(numbers('720 000').map(n => n.value)).toEqual([720_000]);
    expect(numbers('1 200 000').map(n => n.value)).toEqual([1_200_000]);
    expect(numbers('720.000').map(n => n.value)).toEqual([720_000]);
    expect(numbers('1.200.000').map(n => n.value)).toEqual([1_200_000]);
    expect(numbers('85,5 litr').map(n => n.value)).toEqual([85.5]);
    expect(numbers('6 mingdan')[0]).toMatchObject({ value: 6000, after: 'dan' });
    expect(numbers('50k').map(n => n.value)).toEqual([50_000]);
    expect(numbers('2 mlrd').map(n => n.value)).toEqual([2_000_000_000]);
  });

  it('keeps "120 6000" as two numbers', () => {
    expect(numbers('120 6000').map(n => n.value)).toEqual([120, 6000]);
  });
});

describe('parseDate', () => {
  it('understands kecha, o\'tgan kuni and dd.mm[.yyyy]', () => {
    expect(parseDate('kecha 80 l', TODAY)).toEqual({ date: '2026-10-20' });
    expect(parseDate('кеча', TODAY)).toEqual({ date: '2026-10-20' });
    expect(parseDate("o'tgan kuni", TODAY)).toEqual({ date: '2026-10-19' });
    expect(parseDate('15.10 yem', TODAY)).toEqual({ date: '2026-10-15' });
    expect(parseDate('3/9/2026', TODAY)).toEqual({ date: '2026-09-03' });
    expect(parseDate('01.01.26', TODAY)).toEqual({ date: '2026-01-01' });
    expect(parseDate('900 ming yem', TODAY)).toEqual({});
  });

  it('rejects impossible and future dates', () => {
    expect(parseDate('31.02', TODAY).error).toContain("Bunday sana yo'q");
    expect(parseDate('25.10', TODAY).error).toContain('kelajakda');
  });

  it('decimals with a dot are numbers, not dates', () => {
    expect(parseDate('1.5 mln yem', TODAY)).toEqual({});
    expect(parseDate("12.5 litr sog'dik", TODAY)).toEqual({});
    expect(parseDate('85.5', TODAY)).toEqual({});
    expect(parseDate('1.200.000', TODAY)).toEqual({});
    expect(parseEntry('pichan 3.5 mln', TODAY)).toEqual({ kind: 'expense', category: 'feed', amount: 3_500_000 });
    expect(parseEntry("12.5 litr sut sog'dik", TODAY)).toEqual({ kind: 'milk', qty: 12.5, unit: 'l' });
  });

  it('adds days across month ends', () => {
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
  });
});

describe('parseAmount', () => {
  it('a single number is the amount', () => {
    expect(parseAmount("yemga 900 ming so'm")).toEqual({ amount: 900_000 });
    expect(parseAmount('1,2 mln')).toEqual({ amount: 1_200_000 });
  });

  it('quantity x unit price is always computed by code', () => {
    expect(parseAmount("120 litr sut sotdim, litri 6000 so'm")).toEqual({ qty: 120, unit: 'l', unitPrice: 6000, amount: 720_000 });
    expect(parseAmount('120 litrni 6 mingdan')).toEqual({ qty: 120, unit: 'l', unitPrice: 6000, amount: 720_000 });
    expect(parseAmount('120 l x 6000')).toEqual({ qty: 120, unit: 'l', unitPrice: 6000, amount: 720_000 });
    expect(parseAmount("2 ta buzoq, boshi 4 mln")).toEqual({ qty: 2, unit: 'bosh', unitPrice: 4_000_000, amount: 8_000_000 });
    expect(parseAmount('50 kg kepak kilosi 3000')).toEqual({ qty: 50, unit: 'kg', unitPrice: 3000, amount: 150_000 });
  });

  it('quantity with a total keeps both', () => {
    expect(parseAmount("120 litr sut sotdim 720 ming so'm")).toEqual({ qty: 120, unit: 'l', amount: 720_000 });
  });

  it('ambiguous pairs give nothing - the bot asks again', () => {
    expect(parseAmount('120 6000')).toEqual({});
    expect(parseAmount('sut sotdim')).toEqual({});
  });

  it('ignores the date when looking for money', () => {
    expect(parseAmount('15.10 yem 900 ming')).toEqual({ amount: 900_000 });
  });
});

describe('parseLiters', () => {
  it('accepts exactly one sensible number', () => {
    expect(parseLiters('85')).toBe(85);
    expect(parseLiters('85,5 litr')).toBe(85.5);
    expect(parseLiters('85 90')).toBeUndefined();
    expect(parseLiters('0')).toBeUndefined();
    expect(parseLiters('abc')).toBeUndefined();
  });
});

describe('parseEntry', () => {
  it('milking', () => {
    expect(parseEntry("bugun 85 litr sut sog'dik", TODAY)).toEqual({ kind: 'milk', qty: 85, unit: 'l' });
    expect(parseEntry("kecha 80 l sog'dik", TODAY)).toEqual({ kind: 'milk', qty: 80, unit: 'l', date: '2026-10-20' });
    expect(parseEntry('Бугун 90 литр сут соғдик', TODAY)).toEqual({ kind: 'milk', qty: 90, unit: 'l' });
  });

  it('milk sale', () => {
    expect(parseEntry("120 litr sut sotdim, litri 6000 so'm", TODAY))
      .toEqual({ kind: 'income', category: 'milk', qty: 120, unit: 'l', unitPrice: 6000, amount: 720_000 });
  });

  it('expenses by keyword', () => {
    expect(parseEntry("Yemga 900 ming so'm to'ladim", TODAY)).toEqual({ kind: 'expense', category: 'feed', amount: 900_000 });
    expect(parseEntry('ем 900 минг', TODAY)).toEqual({ kind: 'expense', category: 'feed', amount: 900_000 });
    expect(parseEntry('veterinarga 150 ming berdim', TODAY)).toEqual({ kind: 'expense', category: 'vet', amount: 150_000 });
    expect(parseEntry('ishchiga oylik 2 mln', TODAY)).toEqual({ kind: 'expense', category: 'labor', amount: 2_000_000 });
    expect(parseEntry("svetga 300 ming to'ladim", TODAY)).toEqual({ kind: 'expense', category: 'utilities', amount: 300_000 });
    expect(parseEntry('bitta sigir sotib oldim 15 mln', TODAY)).toMatchObject({ kind: 'expense', category: 'animal', amount: 15_000_000 });
    expect(parseEntry('500 ming xarajat', TODAY)).toEqual({ kind: 'expense', category: 'other', amount: 500_000 });
  });

  it('animal purchase only when the animal is what was bought', () => {
    expect(parseEntry('sigir uchun yem oldim 900 ming', TODAY)).toEqual({ kind: 'expense', category: 'feed', amount: 900_000 });
    expect(parseEntry('2 ta buzoq oldim 8 mln', TODAY)).toMatchObject({ kind: 'expense', category: 'animal', amount: 8_000_000 });
  });

  it("received money is income, not an expense", () => {
    expect(parseEntry("sut uchun to'lov oldim 720 ming", TODAY)).toEqual({ kind: 'income', category: 'milk', amount: 720_000 });
    expect(parseEntry('500 ming pul keldi', TODAY)).toEqual({ kind: 'income', category: 'other', amount: 500_000 });
  });

  it('income by keyword', () => {
    expect(parseEntry('buzoq sotdim 6 mln', TODAY)).toEqual({ kind: 'income', category: 'animal', amount: 6_000_000 });
    expect(parseEntry("go'ng sotildi 400 ming", TODAY)).toEqual({ kind: 'income', category: 'manure', amount: 400_000 });
  });

  it('carries date errors and leaves unknown text alone', () => {
    expect(parseEntry('25.10 yem 900 ming', TODAY)).toMatchObject({ kind: 'expense', dateError: expect.stringContaining('kelajakda') });
    expect(parseEntry('salom', TODAY)).toEqual({});
  });
});

describe('money', () => {
  it('groups thousands with spaces', () => {
    expect(money(1_234_567)).toBe('1 234 567');
    expect(money(-50_000)).toBe('−50 000');
    expect(money(0)).toBe('0');
  });
});

describe('parseMilkAnswer', () => {
  it('a lone number is litres, a date or kecha moves the day', () => {
    expect(parseMilkAnswer('85', TODAY)).toEqual({ qty: 85 });
    expect(parseMilkAnswer('12.5', TODAY)).toEqual({ qty: 12.5 });
    expect(parseMilkAnswer('85,5 l', TODAY)).toEqual({ qty: 85.5 });
    expect(parseMilkAnswer('kecha 80', TODAY)).toEqual({ qty: 80, date: '2026-10-20' });
    expect(parseMilkAnswer('kecha 12.5', TODAY)).toEqual({ qty: 12.5, date: '2026-10-20' });
    expect(parseMilkAnswer('15.10 80', TODAY)).toEqual({ qty: 80, date: '2026-10-15' });
    expect(parseMilkAnswer('25.10 80', TODAY).error).toContain('kelajakda');
    expect(parseMilkAnswer('80 90', TODAY)).toEqual({});
    expect(parseMilkAnswer("ko'p", TODAY)).toEqual({});
  });
});
