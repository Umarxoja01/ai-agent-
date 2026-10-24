# /fix: bepul bag tuzatuvchi skill (Claude Code)

Claude Code obunangiz ichida ishlaydi, qo'shimcha to'lov yo'q. Bu Managed Agent'ning bepul varianti: bulut yo'q, `ant` yo'q, kalitlar yo'q.

Agar Claude Code'ga obuna orqali emas, API kaliti orqali kirsangiz, sarf tokenlar bo'yicha hisoblanadi.

## O'rnatish (har bir loyihaga bir marta)

```sh
mkdir -p <loyiha>/.claude/skills
cp -r senior-bug-fixer/claude-code-skill/fix <loyiha>/.claude/skills/
```

Keyin shu loyihada Claude Code'ni oching va bir marta ishga tushiring:

```
/fix soha
```

U loyihani o'rganadi, `SOHA.md` ni to'ldiradi va sizga 3 ta savol beradi: qanday qoidalar bor, nima tez-tez buziladi, "tayyor" nimani anglatadi. Javoblaringiz agentni **aynan sizning sohangiz ustasi**ga aylantiradi.

## Ishlatish

```
/fix login bo'sh parolda ham o'tkazib yuboryapti
/fix <stack trace'ni shu yerga joylang>
```

Ish tartibi:
1. bagni test bilan takrorlaydi;
2. ildiz sababini topadi;
3. minimal tuzatadi;
4. testlar bilan isbotlaydi;
5. `fix/...` branch'ga commit qiladi;
6. yangi narsa o'rgangan bo'lsa, `DARSLAR.md` ga dars yozadi.

## Nega arzon va kuchli

- **Tor bilim, kam o'qish.** Agent loyihani har safar qaytadan o'rganmaydi: xaritani `SOHA.md` dan oladi va faqat kerakli modulni o'qiydi.
- **O'z-o'zini kuchaytiradi.** `DARSLAR.md` vaqt o'tishi bilan to'lib boradi. Bir dars uch marta takrorlansa, u doimiy qoidaga aylanadi.
- **Isbotsiz tuzatish yo'q.** Har bir tuzatish avval yiqilgan, keyin o'tgan test bilan isbotlanadi.

`SOHA.md` va `DARSLAR.md` ni git'ga commit qiling. Shunda bilim hamma sessiyalarga va jamoangizdagi barcha odamlarga o'tadi.
