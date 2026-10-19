import type { Env } from './env';
import * as db from './db';
import { T, isLang, type Lang } from './i18n';
import { categoryName, money, productName, unitName } from './render';
import { tg } from './tg';
import { esc, ID_RE } from './util';

const PAGE_TEXT = {
  uz: {
    title: 'VETCO — veterinariya preparatlari katalogi',
    lead: 'Chorva uchun veterinariya preparatlari. Narx va yetkazib berishni operator bilan kelishasiz.',
    order: 'Telegramda buyurtma berish',
    orderOne: 'Buyurtma',
    empty: 'Katalog hozircha boʻsh.',
    other: 'Русский',
    note: 'Qoʻllashdan oldin yoʻriqnomani oʻqing va veterinar bilan maslahatlashing. Dozani veterinar belgilaydi.',
    phone: 'Telefon',
  },
  ru: {
    title: 'VETCO — каталог ветеринарных препаратов',
    lead: 'Ветеринарные препараты для животноводства. Цену и доставку согласуете с оператором.',
    order: 'Заказать в Telegram',
    orderOne: 'Заказать',
    empty: 'Каталог пока пуст.',
    other: 'Oʻzbekcha',
    note: 'Перед применением прочитайте инструкцию и проконсультируйтесь с ветеринаром. Дозировку определяет ветеринар.',
    phone: 'Телефон',
  },
} satisfies Record<Lang, Record<string, string>>;

/** Cache-busting version for /img/<id> when a photo is replaced. */
function shortHash(text: string): string {
  let h = 0;
  for (let i = 0; i < text.length; i++) h = (Math.imul(h, 31) + text.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

function botLink(env: Env, start?: string): string | null {
  const name = (env.BOT_USERNAME ?? '').replace(/^@/, '');
  if (!/^[A-Za-z0-9_]{5,32}$/.test(name)) return null;
  return `https://t.me/${name}${start ? `?start=${start}` : ''}`;
}

export async function catalogPage(env: Env, url: URL): Promise<Response> {
  const q = url.searchParams.get('lang');
  const lang: Lang = isLang(q) ? q : 'uz';
  const t = PAGE_TEXT[lang];
  const products = await db.listProducts(env.DB);
  const groups = new Map<string, db.Product[]>();
  for (const p of products) {
    const list = groups.get(p.category) ?? [];
    list.push(p);
    groups.set(p.category, list);
  }

  const sections = [...groups.values()]
    .map((list) => {
      const cards = list
        .map((p) => {
          const img = p.photo_url || (p.photo_file_id ? `/img/${p.id}?v=${shortHash(p.photo_file_id)}` : null);
          const form = lang === 'ru' ? p.form_ru || p.form_uz : p.form_uz || p.form_ru;
          const desc = lang === 'ru' ? p.description_ru || p.description_uz : p.description_uz || p.description_ru;
          const price =
            p.price != null
              ? `<b>${esc(money(p.price, lang))}</b> / ${esc(unitName(p, lang))}`
              : esc(`${T[lang].price}: ${T[lang].priceOnRequest}`);
          const link = botLink(env, `p_${p.id}`);
          return `<article class="card">
  <div class="ph">${img ? `<img src="${esc(img)}" alt="${esc(productName(p, lang))}" loading="lazy">` : `<span>${esc(productName(p, lang).slice(0, 1))}</span>`}</div>
  <div class="body">
    <h3>${esc(productName(p, lang))}</h3>
    ${p.maker ? `<p class="muted">${esc(p.maker)}</p>` : ''}
    ${form ? `<p>${esc(form)}</p>` : ''}
    ${p.ingredient ? `<p class="muted">${esc(p.ingredient)}</p>` : ''}
    ${desc ? `<p>${esc(desc)}</p>` : ''}
    <p class="price">${price}</p>
    <p class="stock ${p.in_stock ? 'in' : 'out'}">${esc(p.in_stock ? T[lang].inStock : T[lang].outOfStock)}</p>
    ${link ? `<a class="btn" href="${esc(link)}">${esc(t.orderOne)}</a>` : ''}
  </div>
</article>`;
        })
        .join('\n');
      return `<section><h2>${esc(categoryName(list[0]!, lang))}</h2><div class="grid">${cards}</div></section>`;
    })
    .join('\n');

  const main = botLink(env);
  const phone = env.CONTACT_PHONE
    ? `<p>${esc(t.phone)}: <a href="tel:${esc(env.CONTACT_PHONE.replace(/[^\d+]/g, ''))}">${esc(env.CONTACT_PHONE)}</a></p>`
    : '';
  const html = `<!doctype html>
<html lang="${lang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(t.title)}</title>
<meta name="description" content="${esc(t.lead)}">
<style>
:root{--g1:#007D08;--g2:#109508;--g3:#008F4A;--ink:#181617;--bg:#f4f8f4;--card:#fff;--muted:#5c665c;--line:#dfe8df}
@media (prefers-color-scheme:dark){:root{--bg:#0f1510;--card:#18211a;--ink:#eef4ee;--muted:#a3b2a4;--line:#29352b}}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--ink);font:16px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
header{background:linear-gradient(135deg,var(--g1),var(--g3));color:#fff;padding:28px 16px 32px}
.wrap{max-width:1040px;margin:0 auto;padding:0 16px}
header .wrap{padding:0}
.top{display:flex;justify-content:space-between;align-items:center;gap:12px}
.logo{font-weight:800;font-size:28px;letter-spacing:2px}
.lang{color:#fff;opacity:.9;font-size:14px}
header p{max-width:620px;margin:12px 0 18px;opacity:.95}
.cta{display:inline-block;background:#fff;color:var(--g1);font-weight:700;padding:12px 18px;border-radius:10px;text-decoration:none}
h2{font-size:20px;margin:28px 0 12px;color:var(--g2)}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(230px,1fr));gap:14px}
.card{background:var(--card);border:1px solid var(--line);border-radius:14px;overflow:hidden;display:flex;flex-direction:column}
.ph{aspect-ratio:4/3;background:#e8f2e8;display:flex;align-items:center;justify-content:center}
.ph img{width:100%;height:100%;object-fit:contain;background:#fff}
.ph span{font-size:48px;font-weight:800;color:var(--g2)}
.body{padding:12px 14px 16px;display:flex;flex-direction:column;gap:2px;flex:1}
.body h3{margin:0 0 2px;font-size:18px}
.body p{margin:0;font-size:14px}
.muted{color:var(--muted)}
.price{margin-top:8px!important;font-size:15px!important}
.stock.in{color:var(--g2)}.stock.out{color:var(--muted)}
.btn{margin-top:auto;align-self:flex-start;background:var(--g2);color:#fff;text-decoration:none;font-weight:600;padding:8px 14px;border-radius:8px;margin-top:10px}
footer{color:var(--muted);font-size:14px;padding:28px 16px 40px}
footer a{color:var(--g2)}
</style>
</head>
<body>
<header><div class="wrap">
  <div class="top"><div class="logo">VETCO</div><a class="lang" href="?lang=${lang === 'uz' ? 'ru' : 'uz'}">${esc(t.other)}</a></div>
  <p>${esc(t.lead)}</p>
  ${main ? `<a class="cta" href="${esc(main)}">${esc(t.order)}</a>` : ''}
</div></header>
<main class="wrap">
${sections || `<p>${esc(t.empty)}</p>`}
</main>
<footer class="wrap">
  <p>⚠️ ${esc(t.note)}</p>
  ${phone}
</footer>
</body>
</html>`;
  return new Response(html, {
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'public, max-age=300' },
  });
}

/** Serves a product photo uploaded through the bot without exposing the bot token. */
export async function productImage(env: Env, id: string, request: Request, exec: ExecutionContext): Promise<Response> {
  if (!ID_RE.test(id)) return new Response('Not found', { status: 404 });
  const p = await db.getProduct(env.DB, id);
  if (!p?.photo_file_id) return new Response('Not found', { status: 404 });
  // One cache entry per photo version, whatever query string the request carries.
  const key = new Request(`${new URL(request.url).origin}/img/${id}?v=${shortHash(p.photo_file_id)}`);
  const cache = caches.default;
  const cached = await cache.match(key);
  if (cached) return cached;
  try {
    const file = await tg<{ file_path?: string }>(env, 'getFile', { file_id: p.photo_file_id });
    if (!file.file_path) throw new Error('no file_path');
    const base = env.TELEGRAM_API || 'https://api.telegram.org';
    const upstream = await fetch(`${base}/file/bot${env.BOT_TOKEN}/${file.file_path}`);
    if (!upstream.ok || !upstream.body) throw new Error(`HTTP ${upstream.status}`);
    const res = new Response(upstream.body, {
      headers: {
        'Content-Type': upstream.headers.get('Content-Type')?.startsWith('image/') ? upstream.headers.get('Content-Type')! : 'image/jpeg',
        'Cache-Control': 'public, max-age=86400',
      },
    });
    exec.waitUntil(cache.put(key, res.clone()));
    return res;
  } catch (err) {
    console.warn(`image ${id}: ${err instanceof Error ? err.message : err}`);
    return new Response('Not found', { status: 404 });
  }
}
