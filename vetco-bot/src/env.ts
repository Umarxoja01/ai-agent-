export interface Env {
  DB: D1Database;

  // Secrets (wrangler secret put ...)
  BOT_TOKEN: string;
  /** Sent by Telegram in X-Telegram-Bot-Api-Secret-Token; set by POST /api/setup. */
  WEBHOOK_SECRET: string;
  /** Bearer token for /api/* (Jarvis, Umar's laptop, curl). */
  ADMIN_TOKEN: string;
  /** Google Apps Script web app that upserts orders into the "Buyurtmalar" sheet (optional). */
  SHEETS_WEBHOOK_URL?: string;
  SHEETS_WEBHOOK_KEY?: string;

  // Plain vars (wrangler.jsonc "vars")
  /** Chat that receives new orders and customer questions: a private chat or a staff group. */
  ADMIN_CHAT_ID: string;
  /** Comma separated Telegram user ids allowed to change order status and run admin commands. */
  ADMIN_USER_IDS: string;
  BOT_USERNAME?: string;
  /** Google Sheet "VETCO katalog" published as CSV (File > Share > Publish to web > CSV). */
  CATALOG_CSV_URL?: string;
  /** Manual payment links shown after an operator confirms the order; may contain {order} and {amount}. */
  PAYME_URL?: string;
  CLICK_URL?: string;
  CONTACT_PHONE?: string;
  CONTACT_TEXT_UZ?: string;
  CONTACT_TEXT_RU?: string;
  /** Override for tests; defaults to https://api.telegram.org */
  TELEGRAM_API?: string;
}
