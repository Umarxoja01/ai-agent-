import type { Env } from './env';
import type { Order } from './db';
import { STATUS, regionName } from './i18n';
import { tashkentTime } from './render';

/** One row of the "Buyurtmalar" sheet; the Apps Script upserts by id. */
export function sheetRow(o: Order): Record<string, string | number> {
  return {
    id: o.id,
    created: tashkentTime(o.created_at),
    status: STATUS[o.status].uz,
    customer: o.customer_name,
    phone: o.phone,
    region: regionName(o.region, 'uz'),
    address: o.address,
    note: o.note ?? '',
    items: o.items.map((it) => `${it.name} × ${it.qty}`).join('; '),
    total: o.total ?? '',
    lang: o.lang,
    telegram: o.username ? `@${o.username}` : '',
    chat_id: o.chat_id,
    updated: tashkentTime(o.updated_at),
  };
}

/** Sends the order to Google Sheets; marks it synced unless it changed meanwhile. */
export async function pushOrder(env: Env, order: Order): Promise<boolean> {
  if (!env.SHEETS_WEBHOOK_URL || !env.SHEETS_WEBHOOK_KEY) return false;
  try {
    const res = await fetch(env.SHEETS_WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: env.SHEETS_WEBHOOK_KEY, order: sheetRow(order) }),
      redirect: 'follow',
    });
    const body = (await res.json().catch(() => ({}))) as { ok?: boolean };
    if (!res.ok || !body.ok) {
      console.warn(`sheets push #${order.id}: HTTP ${res.status}`);
      return false;
    }
  } catch (err) {
    console.warn(`sheets push #${order.id}: ${err instanceof Error ? err.message : err}`);
    return false;
  }
  await env.DB.prepare('UPDATE orders SET sheets_synced = 1 WHERE id = ? AND updated_at = ?')
    .bind(order.id, order.updated_at)
    .run();
  return true;
}
