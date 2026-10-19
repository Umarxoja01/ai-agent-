import type { Env } from './env';
import * as db from './db';
import { syncCatalog } from './catalog';
import { A, STATUS, T, type Status } from './i18n';
import { NEXT_STATUS, adminOrderView, money, paymentKeyboard, tashkentTime } from './render';
import { pushOrder } from './sheets';
import { TgError, editOrSend, inline, sendMessage, tg, type TgCallbackQuery, type TgMessage } from './tg';
import { esc, groupDigits, ID_RE, nowIso, parseIdList } from './util';

export const ADMIN_COMMANDS = new Set(['orders', 'order', 'stats', 'sync', 'photo', 'help']);

export function adminChatId(env: Env): string {
  return (env.ADMIN_CHAT_ID ?? '').trim();
}

/** Staff: anyone in the operators' chat, or a user listed in ADMIN_USER_IDS. */
export function isStaff(env: Env, userId: number, chatId: number): boolean {
  return (adminChatId(env) !== '' && String(chatId) === adminChatId(env)) || parseIdList(env.ADMIN_USER_IDS).has(userId);
}

export interface Command {
  name: string;
  arg: string;
}

export function parseCommand(text: string): Command | null {
  const m = /^\/([a-z_]+)(?:@\w+)?(?:\s+([\s\S]*))?$/i.exec(text.trim());
  return m ? { name: m[1]!.toLowerCase(), arg: (m[2] ?? '').trim() } : null;
}

/** Posts the order card to the operators' chat and remembers it for replies and retries. */
export async function notifyNewOrder(env: Env, order: db.Order): Promise<void> {
  const chat = adminChatId(env);
  if (!chat) {
    console.error(`order #${order.id}: ADMIN_CHAT_ID is not set`);
    return;
  }
  const view = adminOrderView(order);
  const sent = await sendMessage(env, chat, view.text, inline(view.keyboard));
  await db.setAdminMessage(env.DB, order.id, sent.message_id);
  await db.addRelay(env.DB, sent.message_id, order.chat_id, order.id);
}

export async function adminCommand(env: Env, msg: TgMessage, cmd: Command): Promise<void> {
  const chatId = msg.chat.id;
  switch (cmd.name) {
    case 'help':
      await sendMessage(env, chatId, A.help);
      return;
    case 'sync': {
      const report = await syncCatalog(env);
      const lines = [report.ok ? A.syncOk(report.active, report.total) : A.syncFailed(report.errors[0] ?? '')];
      const rest = report.ok ? report.errors : report.errors.slice(1);
      if (rest.length) lines.push('', A.syncErrors(rest.length), ...rest.slice(0, 20).map((e) => `• ${esc(e)}`));
      await sendMessage(env, chatId, lines.join('\n'));
      return;
    }
    case 'photo': {
      const id = cmd.arg.toLowerCase();
      const photo = msg.photo?.at(-1);
      if (!photo || !ID_RE.test(id)) {
        await sendMessage(env, chatId, A.photoUsage);
        return;
      }
      const product = await db.getProduct(env.DB, id, false);
      if (!product) {
        await sendMessage(env, chatId, A.photoNoProduct(esc(id)));
        return;
      }
      await db.setProductPhoto(env.DB, id, photo.file_id);
      await sendMessage(env, chatId, A.photoSaved(esc(product.name)));
      return;
    }
    case 'order': {
      const order = await db.getOrder(env.DB, Number(cmd.arg.replace('#', '')));
      if (!order) {
        await sendMessage(env, chatId, A.orderMissing);
        return;
      }
      const view = adminOrderView(order);
      const sent = await sendMessage(env, chatId, view.text, inline(view.keyboard));
      if (String(chatId) === adminChatId(env)) await db.addRelay(env.DB, sent.message_id, order.chat_id, order.id);
      return;
    }
    case 'orders': {
      const orders = await db.listOpenOrders(env.DB);
      if (!orders.length) {
        await sendMessage(env, chatId, A.ordersNone);
        return;
      }
      const lines = orders.map((o) => {
        const sum = o.total != null ? ` · ${groupDigits(o.total)}` : '';
        return `#${o.id} · ${tashkentTime(o.created_at)} · ${esc(o.customer_name)} · ${esc(o.phone)}${sum}\n${STATUS[o.status].uz}`;
      });
      await sendMessage(env, chatId, [A.ordersOpen, '', ...lines, '', 'Kartani ochish: /order 12'].join('\n'));
      return;
    }
    case 'stats': {
      const day = 86400_000;
      const since = (days: number) => new Date(Date.now() - days * day).toISOString();
      const startOfToday = new Date(Math.floor((Date.now() + 5 * 3600_000) / day) * day - 5 * 3600_000).toISOString();
      const row = await env.DB.prepare(
        `SELECT
           SUM(created_at >= ?1) AS today,
           SUM(created_at >= ?2) AS week,
           SUM(created_at >= ?3) AS month,
           SUM(CASE WHEN created_at >= ?3 AND total IS NOT NULL THEN total ELSE 0 END) AS sum
         FROM orders WHERE status != 'cancelled'`,
      )
        .bind(startOfToday, since(7), since(30))
        .first<{ today: number | null; week: number | null; month: number | null; sum: number | null }>();
      await sendMessage(env, chatId, A.stats(row?.today ?? 0, row?.week ?? 0, row?.month ?? 0, groupDigits(row?.sum ?? 0)));
      return;
    }
  }
}

/** Status buttons under an order card: ad:<orderId>:<status>. Returns the toast text. */
export async function adminStatusCallback(env: Env, cb: TgCallbackQuery, exec: ExecutionContext): Promise<string> {
  const [, idText, to] = (cb.data ?? '').split(':');
  const chatId = cb.message?.chat.id ?? 0;
  if (!isStaff(env, cb.from.id, chatId)) return A.notAdmin;
  const order = await db.getOrder(env.DB, Number(idText));
  if (!order) return A.orderMissing;
  const target = to as Status;
  if (!NEXT_STATUS[order.status].includes(target) || !(await db.setOrderStatus(env.DB, order.id, order.status, target))) {
    // Someone else changed it first: show the current state.
    const fresh = (await db.getOrder(env.DB, order.id)) ?? order;
    const view = adminOrderView(fresh);
    if (cb.message) await editOrSend(env, chatId, cb.message, view.text, inline(view.keyboard));
    return A.badTransition;
  }
  const updated = (await db.getOrder(env.DB, order.id))!;
  const view = adminOrderView(updated, `${cb.from.first_name}, ${tashkentTime(nowIso())}`);
  exec.waitUntil(pushOrder(env, updated));
  if (cb.message) {
    try {
      await editOrSend(env, chatId, cb.message, view.text, inline(view.keyboard));
    } catch (err) {
      // The status is saved; the customer must still hear about it.
      console.warn(`order #${updated.id}: card refresh failed: ${err instanceof TgError ? err.description : err}`);
    }
  }

  const t = T[updated.lang];
  let text = t.statusChanged(updated.id, STATUS[target][updated.lang]);
  const keyboard = target === 'confirmed' ? paymentKeyboard(env, updated) : [];
  if (keyboard.length) {
    text += `\n\n${t.payPrompt(updated.total != null ? money(updated.total, updated.lang) : null)}\n${t.receiptHint}`;
  }
  try {
    await sendMessage(env, updated.chat_id, text, keyboard.length ? inline(keyboard) : undefined);
  } catch (err) {
    return A.replyFailed(err instanceof TgError ? err.description : 'xato');
  }
  return A.saved;
}

/** Delivers an operator's reply (text, photo, file, voice...) to the customer. */
export async function relayToCustomer(env: Env, msg: TgMessage, customerChatId: number): Promise<void> {
  const session = await db.getSession(env.DB, customerChatId);
  const lang = session.lang ?? 'uz';
  try {
    if (msg.text !== undefined) {
      await sendMessage(env, customerChatId, `${T[lang].operatorSays}\n${esc(msg.text)}`);
    } else {
      await tg(env, 'copyMessage', { chat_id: customerChatId, from_chat_id: msg.chat.id, message_id: msg.message_id });
    }
    await sendMessage(env, msg.chat.id, A.replySent, undefined, { reply_parameters: { message_id: msg.message_id } });
  } catch (err) {
    const why = err instanceof TgError ? err.description : 'xato';
    await sendMessage(env, msg.chat.id, A.replyFailed(esc(why)), undefined, {
      reply_parameters: { message_id: msg.message_id },
    });
  }
}
