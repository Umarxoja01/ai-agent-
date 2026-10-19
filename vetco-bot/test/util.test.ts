import { describe, expect, it } from 'vitest';
import { menuKeyOf } from '../src/i18n';
import { paymentUrl, tashkentTime } from '../src/render';
import { splitHtml, visibleLength } from '../src/tg';
import { esc, groupDigits, normalizePhone, parseIdList, safeEqual } from '../src/util';

describe('util', () => {
  it('normalizes Uzbek and international phone numbers', () => {
    expect(normalizePhone('90 123 45 67')).toBe('+998901234567');
    expect(normalizePhone('+998 (90) 123-45-67')).toBe('+998901234567');
    expect(normalizePhone('998901234567')).toBe('+998901234567');
    expect(normalizePhone('+7 701 123 4567')).toBe('+77011234567');
    expect(normalizePhone('12345')).toBeNull();
    expect(normalizePhone('call me')).toBeNull();
    expect(normalizePhone('8 901 234 56 78')).toBeNull();
  });

  it('escapes HTML', () => {
    expect(esc('<a href="x">&</a>')).toBe('&lt;a href=&quot;x&quot;&gt;&amp;&lt;/a&gt;');
    expect(esc(null)).toBe('');
  });

  it('compares secrets', () => {
    expect(safeEqual('abc', 'abc')).toBe(true);
    expect(safeEqual('abc', 'abd')).toBe(false);
    expect(safeEqual('abc', 'abcd')).toBe(false);
    expect(safeEqual('', '')).toBe(true);
  });

  it('formats numbers, ids and times', () => {
    expect(groupDigits(1250000)).toBe('1 250 000');
    expect([...parseIdList(' 12, x, 34 ,')]).toEqual([12, 34]);
    expect(tashkentTime('2026-10-19T20:30:00.000Z')).toBe('20.10.2026 01:30');
  });

  it('matches menu labels in both languages', () => {
    expect(menuKeyOf('🛒 Katalog')).toBe('catalog');
    expect(menuKeyOf('🧺 Корзина')).toBe('cart');
    expect(menuKeyOf('Katalog')).toBeNull();
  });

  it('fills payment link templates and refuses non-https links', () => {
    const order = { id: 12, total: 90000 } as any;
    expect(paymentUrl('https://pay.example/?o={order}&a={amount}', order)).toBe('https://pay.example/?o=12&a=90000');
    expect(paymentUrl('http://pay.example/', order)).toBeNull();
    expect(paymentUrl('javascript:alert(1)', order)).toBeNull();
    expect(paymentUrl(undefined, order)).toBeNull();
  });

  it('measures and splits long HTML on line breaks', () => {
    expect(visibleLength('<b>a&amp;b</b>')).toBe(3);
    const lines = Array.from({ length: 50 }, (_, i) => `<b>${i}</b> ${'x'.repeat(100)}`);
    const chunks = splitHtml(lines.join('\n'), 1000);
    expect(chunks.length).toBeGreaterThan(5);
    expect(chunks.every((c) => visibleLength(c) <= 1000)).toBe(true);
    expect(chunks.join('\n')).toBe(lines.join('\n'));
    expect(splitHtml('short')).toEqual(['short']);
  });
});
