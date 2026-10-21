# Fermer hisobchisi - Telegram bot

Har qanday fermer uchun bepul hisobchi: sut, daromad va xarajatni Telegram'da yozib boradi,
oy oxirida foyda-zarar, sut litri, o'rtacha narx va 1 litr sut tannarxini hisoblab beradi.

- **Har fermerning ma'lumoti alohida.** Bitta bot - minglab fermer; hech kim boshqasining yozuvini ko'rmaydi.
- **AI yo'q, pul ketmaydi.** Matn qoidalar bilan tushuniladi (lotin va kirill). Hisob-kitobni kod qiladi, taxmin qilmaydi.
- **Har yozuv tasdiq bilan.** Bot avval kartani ko'rsatadi, fermer ✅ bosmaguncha hech narsa saqlanmaydi.
- **Fermer o'z ma'lumotiga ega:** `/export` - hamma yozuvlar CSV (Excel) faylda, `/delete_me` - hammasini o'chirish.

Jarvis'dan alohida mahsulot: o'z boti, o'z serveri, o'z bazasi. Jarvis botining tokenini bu yerda ishlatmang.

## Fermer qanday ishlatadi

1. Botga `/start` bosadi va fermasi nomini yozadi.
2. Pastdagi tugmalar: 🥛 Sut sog'imi · 💰 Daromad · 💸 Xarajat · 📊 Hisobot · ↩️ Oxirgisini o'chirish · ❓ Yordam.
3. Yoki oddiy yozadi:

| Fermer yozadi | Bot tushunadi |
|---|---|
| `Bugun 85 litr sut sog'dik` | 🥛 sog'im 85 l, bugun |
| `kecha 80 l sog'dik` | 🥛 sog'im 80 l, kecha |
| `120 litr sut sotdim, litri 6000` | 💰 sut sotuvi 120 × 6 000 = 720 000 |
| `120 litrni 6 mingdan` | xuddi shu |
| `Yemga 900 ming to'ladim` | 💸 yem-xashak 900 000 |
| `ем 900 минг` | xuddi shu (kirill) |
| `veterinarga 150 ming` | 💸 veterinar, dori 150 000 |
| `buzoq sotdim 6 mln` | 💰 mol sotuvi 6 000 000 |
| `15.10 yem 1,2 mln` | 💸 yem-xashak 1 200 000, 15-oktabr |
| `900 ming` | "bu nima?" - tugma bilan tanlanadi |
| `o'tgan oy hisoboti` | 📊 o'tgan oy hisobi |

Hisobot: daromad va xarajat toifalar bo'yicha, foyda/zarar, sog'ilgan sut (kuniga o'rtacha),
sotilgan sutning o'rtacha narxi, 1 litr sutga taxminiy xarajat (mol sotib olishsiz), yil uchun oylar jadvali.

## Ishga tushirish

### 1-qadam: yangi bot (Umar qiladi)

Telegram'da **@BotFather** -> `/newbot` -> nom (masalan "Fermer hisobchisi") -> username (`..._bot` bilan tugaydi).
BotFather bergan tokenni hech kimga yubormang, chatga yozmang - faqat serverdagi `.env` faylga.

### 2-qadam: sinov - kompyuterda (Docker Desktop bilan)

```powershell
cd fermer-bot
copy .env.example .env
notepad .env          # BOT_TOKEN=... va ADMIN_IDS=<o'zingizning Telegram id'ingiz>
docker compose up -d --build
docker compose logs -f   # "@..._bot ishga tushdi" chiqishi kerak
```

Docker'siz (Node 22.13+): `npm ci`, `npm run build`, `.env` yarating, `npm start`.

### 3-qadam: bulut server (VPS)

Eng arzon VPS yetadi: Ubuntu 24.04, 1 GB RAM (oyiga ~5 $; masalan Hetzner, DigitalOcean yoki O'zbekistondagi hosting).

```bash
# serverda bir marta
curl -fsSL https://get.docker.com | sh
git clone <repo manzili> && cd <repo>/fermer-bot
cp .env.example .env && nano .env      # BOT_TOKEN va ADMIN_IDS
docker compose up -d --build
docker compose logs -f
```

- **Bir vaqtda faqat bitta nusxa.** Kompyuterda sinab bo'lgach, serverga o'tishdan oldin kompyuterdagisini
  `docker compose down` bilan to'xtating. Aks holda logda `409` chiqadi.
- **Yangilash:** `git pull && docker compose up -d --build` (baza `fermer-data` volume'da qoladi).
- **Zaxira nusxa:** `docker compose exec fermer-bot node --no-warnings scripts/backup.mjs` -
  `/data/backups/` ga izchil nusxa (oxirgi 14 tasi qoladi). Serverdan tashqariga olish:
  `docker compose cp fermer-bot:/data/backups ./backups`. Kuniga bir marta cron bilan qilish tavsiya etiladi.
- **Statistika (faqat admin):** botga `/stats` - fermerlar va yozuvlar soni (hech kimning ma'lumoti emas).

## Muhit o'zgaruvchilari

| Nom | Majburiy | Ma'nosi |
|---|---|---|
| `BOT_TOKEN` | ha | @BotFather tokeni. Logga va xatolarga hech qachon chiqmaydi. |
| `ADMIN_IDS` | yo'q | `/stats` ko'ra oladigan Telegram id'lar, vergul bilan |
| `DB_PATH` | yo'q | SQLite fayl (Docker'da `/data/fermer.db`, aks holda `data/fermer.db`) |
| `TELEGRAM_API_URL` | yo'q | faqat sinov uchun (standart `https://api.telegram.org`) |

## Dasturchi uchun

```bash
npm ci
npm test          # 56 test: matnni tushunish, baza, hisobot, suhbat, Telegram API
npm run typecheck
npm run build && npm run smoke   # qurilgan botni soxta Telegram serveriga ulab boshidan oxirigacha
SMOKE_DOCKER_IMAGE=fermer-bot npm run smoke   # xuddi shu, Docker obrazi bilan
```

| Fayl | Vazifasi |
|---|---|
| `src/parse.ts` | o'zbekcha matn -> raqam, birlik, narx, sana, yozuv turi (AI yo'q) |
| `src/db.ts` | SQLite (`node:sqlite`): fermerlar, yozuvlar, suhbat holati; har so'rov fermer bilan cheklangan |
| `src/report.ts` | davrlar, foyda, sut, tannarx; CSV eksport |
| `src/bot.ts` | suhbat: menyu, qadamlar, tasdiq kartasi, eskirgan karta himoyasi, tezlik cheklovi |
| `src/telegram.ts` | Bot API (kutubxonasiz), long polling, 429 qayta urinish |
| `src/main.ts` | ishga tushirish, offset saqlash, SIGTERM bilan toza to'xtash |

Ish uchun tashqi paket kerak emas (faqat Node 22.13+); `node_modules` faqat test va build uchun.

## Keyingi qadamlar (reja, hali yo'q)

- Pullik tarif (Click/Payme) - bazada `plan` ustuni tayyor, hozir hamma `free`.
- Kunlik eslatma ("bugungi sutni yozdingizmi?"), mollar ro'yxati, davolash va sut kutish muddati.
- Rus tilidagi interfeys.
