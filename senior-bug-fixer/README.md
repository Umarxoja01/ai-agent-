# Senior Bug Fixer — Claude Managed Agent

> Bepul variant (Claude Code obunasi ichida, `/fix` buyrug'i): [`claude-code-skill/`](claude-code-skill/README.md)

Bag tavsifini (yoki GitHub issue raqamini) berasiz. Agent quyidagilarni bajaradi:

1. bagni **yiqiladigan test** bilan takrorlaydi;
2. **ildiz sababini** topadi (`fayl:qator`);
3. **minimal tuzatish** kiritadi;
4. barcha testlar, typecheck va lintni ishga tushirib isbotlaydi;
5. o'z diff'ini senior reviewer sifatida tekshiradi;
6. `fix/...` branch'ga push qiladi va **PR ochadi**.

Merge qilishni faqat siz hal qilasiz. GitHub'dagi har bir harakatdan oldin (PR ochish ham shunga kiradi) agent sizdan terminalda ruxsat so'raydi.

Alohida grader agent natijani 7 bandli rubrika bo'yicha tekshiradi (`app/src/fix-bug.ts` dagi `RUBRIC`). Hamma band bajarilmaguncha agent qayta ishlaydi, eng ko'pi bilan 3 marta.

```
senior-bug-fixer/
  agents/senior-bug-fixer/
    agent.md            # agent: model, vositalar, GitHub MCP, tizim prompti
    environment.yaml    # sandbox: limited tarmoq, npm/pip ochiq
    vault.yaml          # GitHub MCP kaliti uchun "seyf" (kalitning o'zi faylda emas)
  app/                  # TypeScript: bag yuborish va jarayonni kuzatish
  claude-lock.json      # `ant apply` yaratadi, uni commit qiling
```

## 0. Tayyorgarlik (bir marta)

- `ant` CLI **1.34.0 yoki yangiroq** versiyasi kerak: <https://github.com/anthropics/anthropic-cli/releases>. Versiyani `ant --version` bilan tekshirasiz.
- `ant auth login` buyrug'i brauzer orqali kirishni bajaradi, yoki `ANTHROPIC_API_KEY` o'rnatasiz.
- **GitHub fine-grained token**: GitHub → Settings → Developer settings → Fine-grained tokens. Kerakli repolarni tanlang va quyidagi ruxsatlarni bering:
  - `Contents: Read and write` — kodni yuklab olish va push uchun;
  - `Pull requests: Read and write` — PR ochish uchun;
  - `Issues: Read` — `--issue` bilan ishlatsangiz.

## 1. Agentni Anthropic'ga yuklash

Bu buyruqlarni `senior-bug-fixer/` papkasida ishga tushiring:

```sh
cd senior-bug-fixer
ant apply --dry-run -v agents/senior-bug-fixer/agent.md agents/senior-bug-fixer/environment.yaml agents/senior-bug-fixer/vault.yaml
ant apply agents/senior-bug-fixer/agent.md agents/senior-bug-fixer/environment.yaml agents/senior-bug-fixer/vault.yaml
```

Birinchi buyruq rejani ko'rsatadi va hech narsani o'zgartirmaydi. Rejadagi organization va workspace to'g'riligini tekshiring. Ikkinchi buyruq tasdiq so'raydi, keyin agent, environment va vault yaratadi. ID'lar `claude-lock.json` ga yoziladi: **uni commit qiling**, aks holda keyingi `apply` dublikat yaratadi.

## 2. GitHub kalitini vault'ga qo'shish

O'z terminalingizda ishga tushiring. Kalitni chatga yoki faylga yozmang.

```sh
VAULT_ID=$(jq -r '.resources["./agents/senior-bug-fixer/vault.yaml"].id' claude-lock.json)
read -rs CMA_GITHUB_TOKEN && export CMA_GITHUB_TOKEN     # tokenni yashirin so'rovga joylang

# Token faqat api.githubcopilot.com ga (agentning GitHub MCP serveriga) yuboriladi
jq -n -f /dev/stdin <<'JQ' | ant beta:vaults:credentials create --vault-id "$VAULT_ID"
{
  display_name: "GitHub",
  auth: {
    type: "static_bearer",
    mcp_server_url: "https://api.githubcopilot.com/mcp/",
    token: (env.CMA_GITHUB_TOKEN // error("CMA_GITHUB_TOKEN is not set"))
  }
}
JQ

# Tekshiruv (faqat api.github.com ga murojaat qiladi): GitHub login'ingiz chiqishi kerak
curl -sS -H "Authorization: Bearer $CMA_GITHUB_TOKEN" https://api.github.com/user | jq -r .login
unset CMA_GITHUB_TOKEN
```

## 3. Ilovani sozlash

```sh
cd app
npm install && npm run build
cp .env.example .env
jq -r '.resources["./agents/senior-bug-fixer/agent.md"].id, .resources["./agents/senior-bug-fixer/environment.yaml"].id, .resources["./agents/senior-bug-fixer/vault.yaml"].id' ../claude-lock.json
```

Chiqqan 3 ta ID'ni `.env` faylidagi `AGENT_ID`, `ENVIRONMENT_ID`, `VAULT_ID` qatorlariga yozing. `GITHUB_TOKEN` qatoriga o'sha GitHub tokenni yozing: u repo'ni ulash uchun kerak va sandbox'ga kirmaydi.

## 4. Ishga tushirish

```sh
# Avval ulanishni tekshiring: git va GitHub MCP ishlayaptimi (arzon)
npm run fix -- --repo https://github.com/OWNER/REPO --check

# Bag tuzatish
npm run fix -- --repo https://github.com/OWNER/REPO --bug "Login tugmasi bo'sh parolda ham o'tkazib yuboryapti"
npm run fix -- --repo https://github.com/OWNER/REPO --bug-file bug.md
npm run fix -- --repo https://github.com/OWNER/REPO --issue 12
```

- Har bir sessiya uchun xarajat chegarasi standart holatda **$10**. Uni `--budget-usd 20` bilan o'zgartirasiz.
- Skript Console havolasini chiqaradi: agent ishini brauzerda jonli kuzatishingiz mumkin.
- `⏸ Agent ruxsat so'rayapti` chiqsa, `y` (ruxsat) yoki `n` (rad) deb javob bering.

## O'zgartirish

`agent.md` ni tahrirlang va 1-qadamdagi `ant apply` ni qayta ishga tushiring. Agentning yangi versiyasi yaratiladi.

- **Internet (kutubxona hujjatlari):** `web_fetch` ni `enabled: true` qiling va hostlarni `environment.yaml` dagi `allowed_hosts` ga qo'shing.
- **PR ruxsat so'ramasdan ochilsin:** `mcp_toolset` ga `default_config: {permission_policy: {type: auto}}` qo'shing.
- **Agentning `git push`i rad etilsa:** `auto` siyosati uni xavfli deb topgan bo'lishi mumkin. `configs` ga `{name: bash, permission_policy: {type: always_ask}}` qo'shing: shunda har bir buyruq oldidan sizdan so'raydi.
