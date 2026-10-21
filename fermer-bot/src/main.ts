// ===================================================================
// FERMER BOT - ISHGA TUSHIRISH
// ===================================================================
// Muhit o'zgaruvchilari:
//   BOT_TOKEN   - @BotFather bergan token (majburiy; logga chiqmaydi)
//   DB_PATH     - SQLite fayl (standart: data/fermer.db)
//   ADMIN_IDS   - /stats ko'ra oladigan Telegram id'lar, vergul bilan
//   TELEGRAM_API_URL - faqat sinov uchun (standart: https://api.telegram.org)
// Bitta nusxa ishlashi kerak: ikkinchisi getUpdates'da 409 oladi.
// ===================================================================

import { createBot } from './bot.js';
import { Store } from './db.js';
import { TelegramApi, TelegramError } from './telegram.js';

const log = (line: string) => console.log(`${new Date().toISOString()} ${line}`);

const token = process.env.BOT_TOKEN?.trim();
if (!token) {
  log("BOT_TOKEN berilmagan. .env faylga BOT_TOKEN=... yozing (README'ga qarang).");
  process.exit(2);
}
const dbPath = process.env.DB_PATH?.trim() || 'data/fermer.db';
const adminIds = (process.env.ADMIN_IDS ?? '').split(',').map(s => Number(s.trim())).filter(n => Number.isSafeInteger(n) && n > 0);

const api = new TelegramApi(token, fetch, process.env.TELEGRAM_API_URL?.trim() || undefined);
const store = new Store(dbPath);
const bot = createBot({ store, api, adminIds, log });
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

let busy = false;
let stopping = false;
function stop() {
  stopping = true;
  // long poll kutayotgan bo'lsa darhol chiqamiz; yozuv ishlanayotgan bo'lsa - tugagach
  if (!busy) { store.close(); process.exit(0); }
}
process.on('SIGTERM', stop);
process.on('SIGINT', stop);

async function main() {
  const me = await api.getMe();
  log(`@${me.username} ishga tushdi (baza: ${dbPath}, admin: ${adminIds.length} ta)`);
  await api.setMyCommands([
    { command: 'start', description: 'Boshlash' },
    { command: 'hisobot', description: 'Shu oy hisobi' },
    { command: 'export', description: 'Hamma yozuvlar CSV faylda' },
    { command: 'yordam', description: 'Yordam va misollar' },
    { command: 'bekor', description: 'Boshlangan ishni bekor qilish' },
    { command: 'delete_me', description: "Ma'lumotimni o'chirish" },
  ]);

  let offset = Number(store.getMeta('offset') ?? 0);
  let backoff = 1_000;
  while (!stopping) {
    let updates;
    try {
      updates = await api.getUpdates(offset, 50);
      backoff = 1_000;
    } catch (error) {
      if (error instanceof TelegramError && error.code === 401) { log("Token noto'g'ri yoki bekor qilingan (401). To'xtadim."); store.close(); process.exit(3); }
      if (error instanceof TelegramError && error.code === 409) log('409: bu bot boshqa joyda ham ishlayapti (ikkinchi nusxa yoki webhook). Bittasini to\'xtating.');
      else log(`getUpdates xato: ${error instanceof Error ? error.message : String(error)}`);
      await sleep(backoff);
      backoff = Math.min(backoff * 2, 60_000);
      continue;
    }
    for (const update of updates) {
      busy = true;
      await bot.handleUpdate(update);
      // ishlangandan keyin: o'chib qolsa qayta ishlanadi (karta tasdiqsiz saqlamaydi)
      offset = update.update_id + 1;
      store.setMeta('offset', String(offset));
      busy = false;
      if (stopping) break;
    }
  }
  store.close();
  process.exit(0);
}

main().catch(error => {
  log(`To'xtadi: ${error instanceof Error ? error.message : String(error)}`);
  try { store.close(); } catch { /* yopiq */ }
  process.exit(1);
});
