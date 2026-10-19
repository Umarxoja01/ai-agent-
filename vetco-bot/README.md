# VETCO bot — Telegram katalog va buyurtma (MVP)

Chorva uchun veterinariya preparatlari: mijoz Telegram'da katalogni koʻradi, savatga soladi va buyurtma beradi;
buyurtma operatorlar guruhiga tugmalar bilan tushadi. Cloudflare Worker + D1 da ishlaydi — noutbuksiz 24/7, $0/oy.
Nima va nega: [SPEC.md](SPEC.md).

```
Mijoz ─► Telegram ─► webhook ─► Cloudflare Worker (src/) ─► D1: katalog, savat, buyurtmalar
                                     │   ├─► operatorlar guruhi: buyurtma kartasi + holat tugmalari
                                     │   └─► (ixtiyoriy) Apps Script ─► Google Sheets "Buyurtmalar"
Google Sheets "VETCO katalog" ─CSV─►─┘   har kuni 08:00 yoki /sync
Instagram bio ─► https://<worker>/  (veb-katalog, har preparatda "Buyurtma" ─► botdagi karta)
Jarvis / noutbuk ─► GET /api/orders (Bearer)
```

## Nimalar bor

- Oʻzbek va rus tili, doimiy menyu: 🛒 Katalog · 🧺 Savat · 📦 Buyurtmalarim · 📞 Aloqa · 🌐 Til.
- Boʻlim → preparat kartasi (rasm, narx yoki "operator aytadi", ombor, muqobil preparat, veterinar ogohlantirishi).
- Savat, buyurtma rasmiylashtirish (ism, telefon tugmasi, 14 viloyat, manzil, izoh), keyingi safar maʼlumotlar eslab qolinadi.
- Operatorlar guruhi: yangi buyurtma kartasi, `✅ Tasdiqlash → 🚚 Yuborildi → 📬 Yetkazildi / ❌ Bekor`, mijozga avtomatik xabar,
  tasdiqlanganda Payme/Click havola tugmalari.
- Mijoz savoli va chek rasmi operatorga boradi; operator **reply** qilsa — javob mijozga ketadi.
- Katalog Google Sheets'dan (`catalog/vetco_katalog.csv` — tayyor shablon, 5 ta faol preparat Umar kutubxonasidan).
- Veb-katalog sahifasi (`/`, `/?lang=ru`) — VETCO yashil ranglarida, Instagram bio uchun.
- Ishonchlilik: ikki marta bosish = bitta buyurtma, takror update bir marta, yetmagan karta 15 daqiqada qayta yuboriladi,
  boʻsh jadval katalogni oʻchirmaydi.

## Oʻrnatish (taxminan 40 daqiqa)

Kerak: Node.js 20+, Cloudflare akkaunti (bepul), Telegram.

### 1. Bot

[@BotFather](https://t.me/BotFather) → `/newbot` → nom `VETCO`, username masalan `vetco_uz_bot` → **token**ni saqlang.
`/setdescription` va `/setuserpic` (VETCO logosi) — ixtiyoriy.

### 2. Loyiha va baza

```bash
cd vetco-bot
npm install
npx wrangler login
npx wrangler d1 create vetco-bot          # chiqqan database_id ni wrangler.jsonc ga qoʻying
npm run db:migrate:remote                 # jadvallar + boshlangʻich katalog
```

### 3. Sirlar (git'ga tushmaydi)

```bash
npx wrangler secret put BOT_TOKEN          # BotFather bergan token
npx wrangler secret put WEBHOOK_SECRET     # openssl rand -hex 32 natijasi
npx wrangler secret put ADMIN_TOKEN        # openssl rand -hex 32 natijasi (Jarvis/curl uchun)
```

### 4. Deploy va webhook

```bash
npm run deploy                             # https://vetco-bot.<subdomain>.workers.dev
curl -X POST -H "Authorization: Bearer <ADMIN_TOKEN>" https://vetco-bot.<subdomain>.workers.dev/api/setup
```

`/api/setup` webhook'ni sir bilan ulaydi va buyruqlar menyusini (uz/ru) qoʻyadi; javobdagi `warnings`ni oʻqing.

### 5. Operatorlar guruhi va ID'lar

1. Telegram'da guruh oching, masalan "VETCO buyurtmalar", botni qoʻshing, VETCO menejerlarini qoʻshing.
2. Guruh sozlamalari → "Yangi aʼzolar uchun chat tarixi" → **Koʻrinadi**. Bu guruhni darhol supergroup'ga aylantiradi
   (ID `-100…` boʻladi). Aks holda Telegram buni keyinroq oʻzi qiladi va ID oʻzgaradi — bot yangi ID'ga oʻzi oʻtadi,
   `/health` da `admin_chat_moved` chiqadi, lekin `ADMIN_CHAT_ID` ni baribir yangilash kerak boʻladi.
3. Guruhda `/id` yozing → `chat_id` (masalan `-1001234567890`).
4. Har operator botga shaxsiy `/id` yozadi → `user_id`.
5. `wrangler.jsonc` → `vars`:

| Oʻzgaruvchi | Misol | Izoh |
|---|---|---|
| `ADMIN_CHAT_ID` | `-1001234567890` | buyurtma va savollar shu chatga; guruh aʼzolari = operator |
| `ADMIN_USER_IDS` | `111111,222222` | `/photo`, `/sync`, `/orders` ni shaxsiy chatda ham ishlata oladiganlar |
| `BOT_USERNAME` | `vetco_uz_bot` | veb-sahifadagi havolalar uchun |
| `CONTACT_PHONE` | `+998 90 123 45 67` | "📞 Aloqa" va sahifada |
| `CONTACT_TEXT_UZ` / `_RU` | `Ish vaqti: 9:00–18:00` | ixtiyoriy |
| `CATALOG_CSV_URL` | `https://docs.google.com/.../pub?output=csv` | 6-qadam |
| `PAYME_URL` / `CLICK_URL` | `https://...{order}...{amount}` | ixtiyoriy, faqat `https://` |

6. `npm run deploy` qayta, keyin `/api/setup` ni yana chaqiring — u guruhni tekshiradi va operator buyruqlari menyusini qoʻyadi.
7. BotFather → `/setjoingroups` → **Disable**: bot boshqa guruhlarga qoʻshilmasin.

Operator guruhda **faqat** bot xabariga reply qilganda yoki `/buyruq` yozganda bot uni koʻradi (Telegram privacy mode) —
bu yetarli. `/photo` ni bot bilan **shaxsiy chatda** yuboring. Mijoz maʼlumotli buyruqlar (`/orders`, `/order`) faqat
operatorlar guruhida yoki shaxsiy chatda ishlaydi.

### 6. Katalog Google Sheets'da

1. Yangi Google Sheet "VETCO katalog" → Fayl → Import → `catalog/vetco_katalog.csv` (Replace current sheet).
2. Narxlarni, tavsifni, yangi preparatlarni toʻldiring. Ustunlar:

| Ustun | Majburiy | Maʼnosi |
|---|---|---|
| `id` | ✅ | lotin kichik harf, raqam, `_` `-`: `bistrepen`. Oʻzgartirmang — Instagram havolalari shunga bogʻlangan |
| `sort` | | tartib raqami |
| `category` | ✅ | boʻlim kodi: `antibiotik`, `vitamin` |
| `category_uz`, `category_ru` | | boʻlim nomi |
| `name` | ✅ | lotincha nom; `name_ru` — kirillcha |
| `maker`, `ingredient` | | ishlab chiqaruvchi, taʼsir etuvchi modda |
| `form_uz`, `form_ru` | | "Inʼeksiya eritmasi, 100 ml" |
| `description_uz`, `description_ru` | | qisqa tavsif (daʼvosiz) |
| `dose_uz`, `dose_ru`, `dose_verified` | | doza **faqat** `dose_verified = ha` boʻlsa koʻrinadi — veterinar/yoʻriqnoma tasdiqlagandan keyin |
| `unit_uz`, `unit_ru` | | `flakon` / `флакон` |
| `price` | | soʻmda: `125000` yoki `125 000`; boʻsh = "operator aytadi" |
| `in_stock`, `active` | | `ha` / `yoʻq` (boʻsh = ha). `active = yoʻq` — botda koʻrinmaydi |
| `photo_url` | | `https://` rasm havolasi (yoki botga `/photo`) |
| `alternatives` | | muqobil `id`lar: `fluneks` |

3. Fayl → Ulashish → **Veb'da eʼlon qilish** → varaq, **CSV** → havolani `CATALOG_CSV_URL` ga, `npm run deploy`.
4. Operatorlar guruhida `/sync` — bot nechta qator qabul qilinganini va xato qatorlarni aytadi. Har kuni 08:00 da avtomatik.

Jadvalda yoʻq preparat oʻchmaydi — `active = 0` boʻladi; eski buyurtmalar oʻz nomi va narxini saqlaydi.

### 7. Preparat rasmlari

Botga shaxsiy chatda rasm yuboring (fayl emas, oddiy rasm), izohiga `/photo bistrepen`. Rasm botda ham, veb-sahifada ham chiqadi.
Tayyor rasmlar Umar kutubxonasida: `_LIBRARY/PRODUCTS/<id>/<id>_photo.jpg`.

### 8. Buyurtmalar Google Sheets'ga (ixtiyoriy)

1. Founder OS (yoki alohida) jadvalda: Kengaytmalar → Apps Script → `apps-script/Code.gs` ni joylang.
2. Project Settings → Script properties: `VETCO_KEY` = `openssl rand -hex 32`.
3. Deploy → New deployment → Web app, Execute as **Me**, Who has access **Anyone** → `/exec` URL.
4. `npx wrangler secret put SHEETS_WEBHOOK_URL` (URL) va `npx wrangler secret put SHEETS_WEBHOOK_KEY` (`VETCO_KEY`).

"Buyurtmalar" varagʻi oʻzi yaratiladi; har holat oʻzgarishi oʻsha qatorni yangilaydi. Yetmay qolganlari 15 daqiqada qayta yuboriladi.

## Operatorlar uchun

- Yangi buyurtma kartasi tagidagi tugmalar holatni oʻzgartiradi; mijoz oʻz tilida xabar oladi.
- Mijozga javob: kartaga yoki "💬 Mijoz xabari"ga **reply** qiling (matn, rasm, fayl, ovoz). `/` bilan boshlangan reply
  mijozga ketmaydi — buyruq sifatida bajariladi.
- Mijozga holat xabari yetmasa (botni bloklagan), guruhda kartaga javob sifatida ⚠️ ogohlantirish va telefon raqami chiqadi.
- `/orders` — ochiq buyurtmalar, `/order 12` — kartani qayta chiqarish (juda uzun buyurtmaning toʻliq roʻyxati bilan),
  `/stats` — statistika, `/sync` — katalog, `/help`.

## Jarvis / noutbuk

```bash
curl -H "Authorization: Bearer <ADMIN_TOKEN>" "https://<worker>/api/orders?since_id=0&format=csv"   # yoki JSON
curl -X POST -H "Authorization: Bearer <ADMIN_TOKEN>" https://<worker>/api/sync
curl https://<worker>/health     # products, unsent_cards (0 boʻlishi kerak), catalog_synced_at, cron_at
```

`since_id` — oxirgi olingan buyurtma raqami (inkremental olish uchun).

## Ishlab chiqish

```bash
npm test             # 71 test: Workers runtime + D1 (miniflare), Telegram soxta
npm run typecheck
npm run dev          # lokal; .dev.vars.example -> .dev.vars
```

Telegram lokal `localhost`ga yeta olmaydi — oqimni testlar tekshiradi (`test/bot.test.ts`).

## Roadmap'dan farqlar

- **KV oʻrniga D1.** KV bepul tarifda kuniga ~1000 yozuv va "eventual consistency" — koʻp bosqichli buyurtma
  (ism → telefon → manzil) va "ikki marta bosish = bitta buyurtma" kafolati uchun yaroqsiz. D1 — SQLite, tranzaksiya, bepul.
- **grammY oʻrniga toʻgʻridan-toʻgʻri Bot API (`fetch`).** Runtime dependency nol — Codex xavfsizlik tekshiruvi uchun
  kod kam, yangilanish xavfi yoʻq.
- **Alohida `vetco-bot` repo oʻrniga** hozircha `ai-agent-/vetco-bot/`. Ajratish:
  `git subtree split -P vetco-bot -b vetco-bot` → yangi private repo'ga push.

## Cheklovlar va xarajat

Cloudflare bepul tarifi (soʻnggi raqamlarni developers.cloudflare.com da tekshiring): Workers — kuniga 100 000 soʻrov,
bitta soʻrovga 10 ms CPU va 50 ta tashqi soʻrov; D1 — 5 GB, kuniga 5 mln qator oʻqish / 100 000 qator yozish.
Bitta buyurtma ~20 ta yozuv — kuniga minglab buyurtmaga yetadi. Cron jadvallarni toʻliq oʻqimaydi (qisman indekslar).
Katalog CSV 300 KB gacha (taxminan 300 preparat qisqa tavsif bilan) — 10 ms CPU ichida oʻqiladi.
Domen ixtiyoriy (~$10/yil); `workers.dev` bepul.

Shaxsiy maʼlumot (ism, telefon, manzil) faqat D1 va (yoqilsa) Google Sheets'da; `/api/orders` faqat `ADMIN_TOKEN` bilan.
