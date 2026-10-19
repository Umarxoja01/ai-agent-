import type { Env } from './env';
import type { Draft, Order, OrderItem, Product } from './db';
import { A, MENU, STATUS, T, regionName, type Lang, type Status } from './i18n';
import type { InlineKeyboard, ReplyKeyboard } from './tg';
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

export function phoneKeyboard(lang: Lang): ReplyKeyboard {
  return {
    keyboard: [[{ text: T[lang].sharePhone, request_contact: true }], [{ text: MENU.catalog[lang] }]],
    resize_keyboard: true,
    one_time_keyboard: true,
  };
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
  if (alternatives.length) lines.push('', `${t.alternative}: ${alternatives.map((a) => esc(productName(a, lang))).join(', ')}`);
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
    out.push(`${i + 1}. ${esc(productName(l.product, lang))} — ${l.qty} ${esc(unit)}${price}`);
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
      return `${i + 1}. ${esc(productName(it, lang))} — ${it.qty} ${esc(unit)}${price}`;
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

export function confirmView(items: OrderItem[], d: Draft, lang: Lang): { text: string; keyboard: InlineKeyboard } {
  const t = T[lang];
  const text = [t.confirmTitle, '', itemsText(items, lang), '', ...totalLines(items, lang), '', draftText(d, lang)].join('\n');
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

export function adminOrderView(o: Order, statusNote?: string): { text: string; keyboard: InlineKeyboard } {
  const who = [esc(o.customer_name), o.username ? `@${esc(o.username)}` : '', `<a href="tg://user?id=${o.chat_id}">profil</a>`]
    .filter(Boolean)
    .join(' · ');
  const lines = [
    A.newOrder(o.id),
    tashkentTime(o.created_at),
    '',
    `${A.customer}: ${who}`,
    `Telefon: ${esc(o.phone)}`,
    `Viloyat: ${esc(regionName(o.region, 'uz'))}`,
    `Manzil: ${esc(o.address)}`,
  ];
  if (o.note) lines.push(`Izoh: ${esc(o.note)}`);
  lines.push(`${A.lang}: ${o.lang === 'ru' ? 'rus' : 'oʻzbek'}`, '', `<b>${A.items}:</b>`, itemsText(o.items, 'uz'), '', ...totalLines(o.items, 'uz'));
  lines.push('', `${A.status}: <b>${STATUS[o.status].uz}</b>${statusNote ? ` (${esc(statusNote)})` : ''}`);
  lines.push('', A.replyHint);
  const next = NEXT_STATUS[o.status].map((s) => ({
    text: STATUS_BUTTON[s as Exclude<Status, 'new'>],
    callback_data: `ad:${o.id}:${s}`,
  }));
  return { text: lines.join('\n'), keyboard: next.length ? [next] : [] };
}

/** Payment link with {order} and {amount} filled in; null when the template is unusable. */
export function paymentUrl(template: string | undefined, order: Order): string | null {
  if (!template) return null;
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
