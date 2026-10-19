# VETCO bot — MVP spetsifikatsiyasi

Roadmap: `JARVIS_FOUNDER_OS_ROADMAP.md`, "45-60-kun. Birinchi MVP: VETCO katalog/buyurtma boti".

## Maqsad

VETCO (Vetco Biotek, hamkor brend NITA-FARM) — chorva uchun veterinariya preparatlari. Mijozlar — fermer
xoʻjaliklari. Hozir buyurtma telefon va shaxsiy chatlarda tarqoq yuradi. MVP:

1. Mijoz Telegram'da katalogni koʻradi va 2 daqiqada buyurtma beradi (oʻzbek yoki rus tilida).
2. Buyurtma darhol operatorlar chatiga tugmalar bilan tushadi; operator holatni bosadi, mijozga avtomatik xabar boradi.
3. Mijozning savoli/cheki operatorga boradi, operator reply qilsa javob mijozga boradi.
4. Katalog Google Sheets'da yuritiladi (VETCO xodimi oʻzi tahrirlaydi, dasturchi kerak emas).
5. Hammasi Umarning noutbukisiz 24/7 ishlaydi va $0/oy (Cloudflare bepul tarifi).

## Foydalanuvchilar

| Kim | Qayerda | Nima qiladi |
|---|---|---|
| Mijoz (fermer) | bot bilan shaxsiy chat | katalog, savat, buyurtma, buyurtmalarim, savol, chek |
| Operator (VETCO menejeri) | "VETCO buyurtmalar" guruhi (`ADMIN_CHAT_ID`) | holat tugmalari, mijozga javob, `/orders`, `/order 12`, `/stats`, `/sync` |
| Umar | `ADMIN_USER_IDS` roʻyxatida | yuqoridagilar + `/photo`, `/api/*`, deploy |
| Jarvis / noutbuk | `GET /api/orders` (Bearer) | buyurtmalarni Founder OS jadvaliga olish |

## Mijoz oqimi

```
/start ─► til (oʻzbek / rus) ─► menyu: 🛒 Katalog · 🧺 Savat · 📦 Buyurtmalarim · 📞 Aloqa · 🌐 Til
Katalog ─► boʻlim ─► preparat kartasi ─► son (1 2 5 10 20 50 yoki ✍️ boshqa) ─► savat
Savat ─► ✅ Buyurtma berish ─► ism/xoʻjalik ─► telefon (📱 tugma yoki yozib) ─► viloyat (14 ta)
      ─► manzil ─► izoh (ixtiyoriy) ─► tekshirish ─► ✅ Tasdiqlash ─► "Buyurtma #12 qabul qilindi"
Keyingi buyurtmada: "Oldingi maʼlumotlar: … Shulardan foydalanaymi?" ─► izoh ─► tasdiqlash
```

- Instagram/saytdan havola: `https://t.me/<bot>?start=p_bistrepen` — preparat kartasi darhol ochiladi.
- Menyudagi tugma istalgan bosqichda buyurtma rasmiylashtirishni toʻxtatadi (savat saqlanadi).
- Erkin matn → operatorga savol. Rasm/fayl → soʻnggi buyurtmaga chek sifatida operatorga.

## Preparat kartasi

Nomi (lotin + kirill), tavsif, ishlab chiqaruvchi, shakli, taʼsir etuvchi modda, narx yoki "operator aytadi",
omborda bor/yoʻq, muqobil preparatlar (masalan Kefen ↔ Fluneks), doimiy ogohlantirish:
"Qoʻllashdan oldin yoʻriqnomani oʻqing va veterinar bilan maslahatlashing."

**Doza faqat `dose_verified = ha` boʻlsa koʻrsatiladi.** Hozirgi dozalar Umarning soʻzlari (OTAVALIKA chati,
2026-09-17), rasmiy yoʻriqnoma bilan tekshirilmagan — shuning uchun boshlangʻich katalogda yashirin.
Samaradorlik haqida daʼvo ("100% davolaydi", "nojoʻya taʼsiri yoʻq") yozilmaydi.

## Buyurtma

Maydonlar: ism/xoʻjalik, telefon (`+998…` ga keltiriladi), viloyat, manzil, izoh, preparatlar
(tasdiqlash paytidagi nom, son, narx surati), jami (barcha narx maʼlum boʻlsa), til, Telegram username.

Holatlar: `🆕 Qabul qilindi → ✅ Tasdiqlandi → 🚚 Yoʻlda → 📬 Yetkazildi`, istalgan ochiq holatdan `❌ Bekor qilindi`.
Har oʻzgarishda mijozga xabar; "Tasdiqlandi"da Payme/Click havola tugmalari (agar sozlangan boʻlsa) va
"chek rasmini shu chatga yuboring".

Toʻlov: qoʻlda havola (`PAYME_URL`, `CLICK_URL`, `{order}` va `{amount}` bilan). Merchant API yoʻq —
toʻlovni operator chek boʻyicha tekshiradi.

## Kafolatlar

- "Tasdiqlash"ni ikki marta bosish bitta buyurtma yaratadi (bitta tranzaksiya, holat sharti).
- Telegram bir update'ni qayta yuborsa, u bir marta ishlanadi.
- Operatorlar chatiga yetmagan buyurtma kartasi har 15 daqiqada qayta yuboriladi.
- Boʻsh yoki buzilgan Google Sheet katalogni oʻchirmaydi.
- Mijoz matni hamma joyda HTML-escape qilinadi; CSV eksportda formula sifatida ishlamaydi.
- Sirlar (token, kalitlar) faqat `wrangler secret`da, git'da yoʻq.

## MVP'ga kirmaydi (keyin, talab boʻlsa)

Payme/Click Merchant API (avtomatik toʻlov tasdigʻi), Telegram Mini App, yetkazib berish narxi hisobi,
mijozga individual narx/chegirma, ombor qoldigʻi soni, koʻp filial, CRM integratsiyasi (hozircha Sheets + `/api/orders`).

## Qabul mezonlari (roadmap "Tekshiruv")

1. Noutbuk oʻchiq — bot katalogni koʻrsatadi va buyurtma operatorlar chatiga yetadi.
2. Haqiqiy VETCO menejeri bilan bitta sinov buyurtmasi: yaratildi → tasdiqlandi → mijozga xabar → Sheets'da qator.
3. Katalogni Sheets'da oʻzgartirish → `/sync` → botda yangi narx.
4. `npm test` yashil; Codex read-only tekshiruvi xulosasi xotirada; sinov sanasi `VERIFICATION.md`da.
