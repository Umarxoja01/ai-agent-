import type { Env } from './env';
import type { Draft, Order, OrderItem, Product } from './db';
import { A, MENU, STATUS, T, regionName, type Lang, type Status } from './i18n';
import { visibleLength, type InlineKeyboard, type ReplyKeyboard } from './tg';
import { esc, groupDigits } from './util';

export function productName(p: { name: string; name_ru: string | null }, lang: Lang): string {
  return lang === 'ru' && p.name_ru ? p.name_ru : p.name;
}

export function categoryName(c: { category: string; category_uz: string | null; category_ru: string | null }, lang: Lang): string {
  return (lang === 'ru' ? c.category_ru || c.category_uz : c.category_uz || c.category_ru) || c.category;
}

export function unitName(p: { unit_uz: string | null; unit_ru: string | null }, lang: Lang): string {
  return (lang === 'ru' ? p.unit_ru : p.unit_uz) || (lang === 'ru' ? 'шт.' : 'dona');
}

export function money(n: number, lang: Lang): string {
  return T[lang].sum(groupDigits(n));
}

/** Russian nouns change after numbers: 1 флакон, 2 флакона, 5 флаконов. */
const RU_UNIT_FORMS: Record<string, [string, string, string]> = {
  флакон: ['флакон', 'флакона', 'флаконов'],
  упаковка: ['упаковка', 'упаковки', 'упаковок'],
  коробка: ['коробка', 'коробки', 'коробок'],
  бутылка: ['бутылка', 'бутылки', 'бутылок'],
  ампула: ['ампула', 'ампулы', 'ампул'],
  пакет: ['пакет', 'пакета', 'пакетов'],
  канистра: ['канистра', 'канистры', 'канистр'],
  шприц: ['шприц', 'шприца', 'шприцев'],
  туба: ['туба', 'тубы', 'туб'],
  банка: ['банка', 'банки', 'банок'],
  штука: ['штука', 'штуки', 'штук'],
};

export function qtyWithUnit(n: number, unit: string, lang: Lang): string {
  const forms = lang === 'ru' ? RU_UNIT_FORMS[unit.toLowerCase()] : undefined;
  if (!forms) return `${n} ${unit}`;
  const d = n % 10;
  const h = n % 100;
  const form = d === 1 && h !== 11 ? 0 : d >= 2 && d <= 4 && (h < 12 || h > 14) ? 1 : 2;
  return `${n} ${forms[form]}`;
}

export function mainMenu(lang: Lang): ReplyKeyboard {
  return {
    keyboard: [
      [{ text: MENU.catalog[lang] }, { text: MENU.cart[lang] }],
      [{ text: MENU.orders[lang] }, { text: MENU.contact[lang] }],
      [{ text: MENU.lang[lang] }],
    ],
    resize_keyboard: true,
    is_persistent: true,
  };
}

/** Share-phone button on top of the usual menu, so leaving the phone step never strands the customer. */
export function phoneKeyboard(lang: Lang): ReplyKeyboard {
  const menu = mainMenu(lang);
  return { ...menu, keyboard: [[{ text: T[lang].sharePhone, request_contact: true }], ...menu.keyboard] };
}

export const QTY_PRESETS = [1, 2, 5, 10, 20, 50];

export function productCard(p: Product, lang: Lang, alternatives: Product[]): { text: string; keyboard: InlineKeyboard } {
  const t = T[lang];
  const lines: string[] = [`<b>${esc(productName(p, lang))}</b>`];
  if (lang === 'ru' && p.name_ru && p.name_ru !== p.name) lines[0] += ` (${esc(p.name)})`;
  if (lang === 'uz' && p.name_ru && p.name_ru !== p.name) lines[0] += ` (${esc(p.name_ru)})`;
  const desc = lang === 'ru' ? p.description_ru || p.description_uz : p.description_uz || p.description_ru;
  if (desc) lines.push('', esc(desc));
  lines.push('');
  if (p.maker) lines.push(`${t.maker}: ${esc(p.maker)}`);
  const form = lang === 'ru' ? p.form_ru || p.form_uz : p.form_uz || p.form_ru;
  if (form) lines.push(`${t.form}: ${esc(form)}`);
  if (p.ingredient) lines.push(`${t.ingredient}: ${esc(p.ingredient)}`);
  const unit = unitName(p, lang);
  lines.push(`${t.price}: ${p.price != null ? `<b>${money(p.price, lang)}</b> / ${esc(unit)}` : t.priceOnRequest}`);
  lines.push(p.in_stock ? t.inStock : t.outOfStock);
  const dose = lang === 'ru' ? p.dose_ru || p.dose_uz : p.dose_uz || p.dose_ru;
  if (p.dose_verified && dose) lines.push('', `<b>${t.dose}:</b> ${esc(dose)}`);
  if (alternatives.length) {
    lines.push('', `${t.alternative(alternatives.length)}: ${alternatives.map((a) => esc(productName(a, lang))).join(', ')}`);
  }
  lines.push('', `<i>${t.vetNote}</i>`, '', esc(t.howMany(unit)));

  const keyboard: InlineKeyboard = [
    QTY_PRESETS.slice(0, 3).map((q) => ({ text: String(q), callback_data: `a:${p.id}:${q}` })),
    QTY_PRESETS.slice(3).map((q) => ({ text: String(q), callback_data: `a:${p.id}:${q}` })),
    [{ text: t.otherQty, callback_data: `q:${p.id}` }],
  ];
  for (const a of alternatives) keyboard.push([{ text: `🔁 ${productName(a, lang)}`, callback_data: `p:${a.id}` }]);
  keyboard.push([
    { text: t.back, callback_data: `c:${p.category}` },
    { text: MENU.cart[lang], callback_data: 'cart' },
  ]);
  return { text: lines.join('\n'), keyboard };
}

export interface PricedLine {
  product: Product;
  qty: number;
}

export function totals(lines: { qty: number; price: number | null }[]): { sum: number; complete: boolean } {
  let sum = 0;
  let complete = true;
  for (const l of lines) {
    if (l.price == null) complete = false;
    else sum += l.price * l.qty;
  }
  return { sum, complete };
}

function totalLines(lines: { qty: number; price: number | null }[], lang: Lang): string[] {
  const t = T[lang];
  const { sum, complete } = totals(lines);
  if (complete) return [`<b>${t.total}: ${money(sum, lang)}</b>`];
  if (sum > 0) return [`${t.totalPartial}: <b>${money(sum, lang)}</b>`, t.restByOperator];
  return [t.allByOperator];
}

export function cartView(lines: PricedLine[], lang: Lang): { text: string; keyboard: InlineKeyboard } {
  const t = T[lang];
  if (!lines.length) return { text: t.cartEmpty, keyboard: [[{ text: t.toCatalog, callback_data: 'cats' }]] };
  const out = [t.cartTitle, ''];
  lines.forEach((l, i) => {
    const unit = unitName(l.product, lang);
    const price = l.product.price != null ? ` = ${money(l.product.price * l.qty, lang)}` : '';
    out.push(`${i + 1}. ${esc(productName(l.product, lang))} — ${esc(qtyWithUnit(l.qty, unit, lang))}${price}`);
  });
  out.push('', ...totalLines(lines.map((l) => ({ qty: l.qty, price: l.product.price })), lang));
  const keyboard: InlineKeyboard = lines.map((l) => [
    { text: `❌ ${productName(l.product, lang)} (${l.qty})`, callback_data: `r:${l.product.id}` },
  ]);
  keyboard.push([{ text: t.checkout, callback_data: 'co' }]);
  keyboard.push([
    { text: t.toCatalog, callback_data: 'cats' },
    { text: t.clearCart, callback_data: 'clr' },
  ]);
  return { text: out.join('\n'), keyboard };
}

export function itemsText(items: OrderItem[], lang: Lang): string {
  return items
    .map((it, i) => {
      const unit = unitName(it, lang);
      const price = it.price != null ? ` × ${money(it.price, lang)} = ${money(it.price * it.qty, lang)}` : '';
      return `${i + 1}. ${esc(productName(it, lang))} — ${esc(qtyWithUnit(it.qty, unit, lang))}${price}`;
    })
    .join('\n');
}

export function draftText(d: Draft, lang: Lang): string {
  const t = T[lang];
  const out = [
    `${t.fName}: ${esc(d.name)}`,
    `${t.fPhone}: ${esc(d.phone)}`,
    `${t.fRegion}: ${esc(regionName(d.region ?? '', lang))}`,
    `${t.fAddress}: ${esc(d.address)}`,
  ];
  if (d.note) out.push(`${t.fNote}: ${esc(d.note)}`);
  return out.join('\n');
}

/** Fingerprint of what the customer approves: lines, quantities and prices. */
export function quoteOf(items: OrderItem[]): string {
  return items.map((i) => `${i.id}:${i.qty}:${i.price ?? '-'}`).join('|');
}

export function confirmView(items: OrderItem[], d: Draft, lang: Lang, notice?: string): { text: string; keyboard: InlineKeyboard } {
  const t = T[lang];
  const head = notice ? [notice, ''] : [];
  const text = [...head, t.confirmTitle, '', itemsText(items, lang), '', ...totalLines(items, lang), '', draftText(d, lang)].join('\n');
  return {
    text,
    keyboard: [[{ text: t.confirm, callback_data: 'ok' }], [{ text: t.cancel, callback_data: 'x' }]],
  };
}

/** Asia/Tashkent is UTC+5 all year. */
export function tashkentTime(iso: string): string {
  const d = new Date(Date.parse(iso) + 5 * 3600_000);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getUTCDate())}.${pad(d.getUTCMonth() + 1)}.${d.getUTCFullYear()} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
}

/** One order in "My orders": at most three item lines so five orders fit one message. */
export function customerOrderLine(o: Order, lang: Lang): string {
  const sum = o.total != null ? ` — ${money(o.total, lang)}` : '';
  const shown = itemsText(o.items.slice(0, 3), lang);
  const more = o.items.length > 3 ? `\n… +${o.items.length - 3}` : '';
  return `<b>#${o.id}</b> · ${tashkentTime(o.created_at)}${sum}\n${STATUS[o.status][lang]}\n${shown}${more}`;
}

export const NEXT_STATUS: Record<Status, Status[]> = {
  new: ['confirmed', 'cancelled'],
  confirmed: ['shipped', 'cancelled'],
  shipped: ['delivered', 'cancelled'],
  delivered: [],
  cancelled: [],
};

const STATUS_BUTTON: Record<Exclude<Status, 'new'>, string> = {
  confirmed: A.setConfirmed,
  shipped: A.setShipped,
  delivered: A.setDelivered,
  cancelled: A.setCancelled,
};

/** Room for the item list on an order card: the whole card must stay one editable message. */
const CARD_BUDGET = 3500;

export function adminOrderView(o: Order, statusNote?: string): { text: string; keyboard: InlineKeyboard; truncated: boolean } {
  const who = [esc(o.customer_name), o.username ? `@${esc(o.username)}` : '', `<a href="tg://user?id=${o.chat_id}">profil</a>`]
    .filter(Boolean)
    .join(' · ');
  const lines = [
    o.status === 'new' ? A.newOrder(o.id) : A.order(o.id),
    tashkentTime(o.created_at),
    '',
    `${A.customer}: ${who}`,
    `Telefon: ${esc(o.phone)}`,
    `Viloyat: ${esc(regionName(o.region, 'uz'))}`,
    `Manzil: ${esc(o.address)}`,
  ];
  if (o.note) lines.push(`Izoh: ${esc(o.note)}`);
  const tail = [
    '',
    ...totalLines(o.items, 'uz'),
    '',
    `${A.status}: <b>${STATUS[o.status].uz}</b>${statusNote ? ` (${esc(statusNote)})` : ''}`,
    '',
    A.replyHint,
  ];
  lines.push(`${A.lang}: ${o.lang === 'ru' ? 'rus' : 'oʻzbek'}`, '', `<b>${A.items}:</b>`);
  let used = visibleLength([...lines, ...tail].join('\n'));
  let shown = 0;
  for (const line of itemsText(o.items, 'uz').split('\n')) {
    const cost = visibleLength(line) + 1;
    if (used + cost > CARD_BUDGET) break;
    lines.push(line);
    used += cost;
    shown++;
  }
  const truncated = shown < o.items.length;
  if (truncated) lines.push(A.moreItems(o.items.length - shown, o.id));
  lines.push(...tail);
  const next = NEXT_STATUS[o.status].map((s) => ({
    text: STATUS_BUTTON[s as Exclude<Status, 'new'>],
    callback_data: `ad:${o.id}:${s}`,
  }));
  return { text: lines.join('\n'), keyboard: next.length ? [next] : [], truncated };
}

/**
 * Payment link with {order} and {amount} filled in; null when the template is unusable
 * or needs an amount the order does not have yet.
 */
export function paymentUrl(template: string | undefined, order: Order): string | null {
  if (!template) return null;
  if (template.includes('{amount}') && order.total == null) return null;
  const url = template
    .replace(/\{order\}/g, encodeURIComponent(String(order.id)))
    .replace(/\{amount\}/g, order.total != null ? String(order.total) : '');
  return /^https:\/\/\S+$/.test(url) ? url : null;
}

export function paymentKeyboard(env: Env, order: Order): InlineKeyboard {
  const row = [
    { label: '💳 Payme', url: paymentUrl(env.PAYME_URL, order) },
    { label: '💳 Click', url: paymentUrl(env.CLICK_URL, order) },
  ]
    .filter((b): b is { label: string; url: string } => !!b.url)
    .map((b) => ({ text: b.label, url: b.url }));
  return row.length ? [row] : [];
}
