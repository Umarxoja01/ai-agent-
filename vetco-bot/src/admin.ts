import type { Env } from './env';
import * as db from './db';
import { syncCatalog } from './catalog';
import { A, STATUS, T, type Status } from './i18n';
import { NEXT_STATUS, adminOrderView, itemsText, money, paymentKeyboard, tashkentTime } from './render';
import { pushOrder } from './sheets';
import {
  TgError,
  editOrSend,
  inline,
  sendMessage,
  tg,
  type InlineKeyboard,
  type TgCallbackQuery,
  type TgMessage,
} from './tg';
import { esc, groupDigits, ID_RE, nowIso, parseIdList } from './util';

export const ADMIN_COMMANDS = new Set(['orders', 'order', 'stats', 'sync', 'photo', 'help']);

/** Key in the meta table holding the operators' chat id after Telegram moved the group. */
export const ADMIN_CHAT_OVERRIDE = 'admin_chat_id';

export function adminChatId(env: Env): string {
  return (env.ADMIN_CHAT_ID ?? '').trim();
}

/**
 * A per-request copy of env with any stored chat move applied: when a basic group becomes
 * a supergroup it gets a new id, and the bot follows it until ADMIN_CHAT_ID is updated by
 * hand. Always a copy, because followChatMove() changes it during the request.
 */
export async function withAdminChatOverride(env: Env): Promise<Env> {
  const moved = await db.getMeta(env.DB, ADMIN_CHAT_OVERRIDE);
  return { ...env, ...(moved && moved.startsWith(`${adminChatId(env)}>`) ? { ADMIN_CHAT_ID: moved.split('>')[1]! } : {}) };
}

/** The stored move, but only while it applies to the configured ADMIN_CHAT_ID. */
export async function activeChatMove(env: Env): Promise<string | null> {
  const moved = await db.getMeta(env.DB, ADMIN_CHAT_OVERRIDE);
  return moved && moved.startsWith(`${(env.ADMIN_CHAT_ID ?? '').trim()}>`) ? moved : null;
}

/**
 * Records that the operators' group moved to a new id (env must be the per-request copy).
 * Only a basic group moves, and a move always lands on a supergroup, so the chat that moved
 * is the configured ADMIN_CHAT_ID itself.
 */
export async function followChatMove(env: Env, newChatId: number): Promise<void> {
  await db.setMeta(env.DB, ADMIN_CHAT_OVERRIDE, `${adminChatId(env)}>${newChatId}`);
  console.error(`operators' chat moved to ${newChatId}: update ADMIN_CHAT_ID in wrangler.jsonc`);
  env.ADMIN_CHAT_ID = String(newChatId);
}

/** Runs a send to the operators' chat, following a group -> supergroup move once. */
async function toOperators<T>(env: Env, send: (chatId: string) => Promise<T>): Promise<T> {
  try {
    return await send(adminChatId(env));
  } catch (err) {
    const moved = err instanceof TgError ? err.parameters.migrate_to_chat_id : undefined;
    if (!moved) throw err;
    await followChatMove(env, moved);
    return send(adminChatId(env));
  }
}

/** Sends a message to the operators' chat and links it to the customer for replies. */
export async function postToOperators(
  env: Env,
  text: string,
  link: Omit<db.RelayRow, 'adminChatId' | 'adminMessageId'>,
  keyboard?: InlineKeyboard,
): Promise<TgMessage> {
  const sent = await toOperators(env, (chat) => sendMessage(env, chat, text, keyboard?.length ? inline(keyboard) : undefined));
  await db.addRelay(env.DB, { ...link, adminChatId: adminChatId(env), adminMessageId: sent.message_id });
  return sent;
}

/** Copies a customer's photo, file or voice note into the operators' chat. */
export async function copyToOperators(
  env: Env,
  fromChatId: number,
  messageId: number,
  link: Omit<db.RelayRow, 'adminChatId' | 'adminMessageId'>,
): Promise<void> {
  const copy = await toOperators(env, (chat) =>
    tg<{ message_id: number }>(env, 'copyMessage', { chat_id: chat, from_chat_id: fromChatId, message_id: messageId }),
  );
  await db.addRelay(env.DB, { ...link, adminChatId: adminChatId(env), adminMessageId: copy.message_id });
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
  if (!adminChatId(env)) {
    console.error(`order #${order.id}: ADMIN_CHAT_ID is not set`);
    return;
  }
  const view = adminOrderView(order);
  const sent = await postToOperators(env, view.text, { chatId: order.chat_id, orderId: order.id, kind: 'card' }, view.keyboard);
  await db.setAdminMessage(env.DB, order.id, sent.message_id);
}

export async function adminCommand(env: Env, msg: TgMessage, cmd: Command): Promise<void> {
  const chatId = msg.chat.id;
  switch (cmd.name) {
    case 'help':
      await sendMessage(env, chatId, A.help);
      return;
    case 'sync': {
      const report = await syncCatalog(env);
      const lines = [report.ok ? A.syncOk(report.active, report.total) : A.syncFailed(esc(report.errors[0] ?? ''))];
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
      if (String(chatId) === adminChatId(env)) {
        await db.addRelay(env.DB, {
          adminChatId: adminChatId(env),
          adminMessageId: sent.message_id,
          chatId: order.chat_id,
          orderId: order.id,
          kind: 'card',
        });
      }
      // The card shortens very long orders; here is the complete list.
      if (view.truncated) await sendMessage(env, chatId, `<b>#${order.id} — ${A.items}:</b>\n${itemsText(order.items, 'uz')}`);
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
      await sendMessage(env, chatId, [A.ordersOpen, '', ...lines, '', A.openCardHint].join('\n'));
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
           COUNT(*) AS month,
           SUM(CASE WHEN total IS NOT NULL THEN total ELSE 0 END) AS sum
         FROM orders WHERE status != 'cancelled' AND created_at >= ?3`,
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
    await refreshCard(env, cb, fresh);
    return A.badTransition;
  }
  const updated = (await db.getOrder(env.DB, order.id))!;
  exec.waitUntil(pushOrder(env, updated));
  try {
    await refreshCard(env, cb, updated, `${cb.from.first_name}, ${tashkentTime(nowIso())}`);
  } catch (err) {
    // The status is saved; the customer must still hear about it.
    console.warn(`order #${updated.id}: card refresh failed: ${err instanceof TgError ? err.description : err}`);
  }

  const t = T[updated.lang];
  let text = t.statusChanged(updated.id, STATUS[target][updated.lang]);
  const keyboard = target === 'confirmed' ? paymentKeyboard(env, updated) : [];
  if (keyboard.length) {
    text += `\n\n${t.payPrompt(updated.total != null ? money(updated.total, updated.lang) : null)}\n${t.receiptHint}`;
  }
  if (target === 'cancelled') text += `\n\n${t.cancelledHint}`;
  try {
    await sendMessage(env, updated.chat_id, text, keyboard.length ? inline(keyboard) : undefined);
  } catch (err) {
    // A toast disappears in two seconds; leave a note every operator can see.
    const why = err instanceof TgError ? err.description : 'xato';
    if (cb.message) {
      await sendMessage(env, chatId, A.customerUnreachable(updated.id, esc(why), esc(updated.phone)), undefined, {
        reply_parameters: { message_id: cb.message.message_id, allow_sending_without_reply: true },
      }).catch(() => undefined);
    }
    return A.replyFailed(why);
  }
  return A.saved;
}

/** Redraws an order card; when Telegram makes us post a new one, it becomes the order's card. */
async function refreshCard(env: Env, cb: TgCallbackQuery, order: db.Order, note?: string): Promise<void> {
  if (!cb.message) return;
  const view = adminOrderView(order, note);
  const chatId = cb.message.chat.id;
  const sent = await editOrSend(env, chatId, cb.message, view.text, inline(view.keyboard));
  if (sent && String(chatId) === adminChatId(env)) {
    await db.setAdminMessage(env.DB, order.id, sent.message_id);
    await db.addRelay(env.DB, {
      adminChatId: adminChatId(env),
      adminMessageId: sent.message_id,
      chatId: order.chat_id,
      orderId: order.id,
      kind: 'card',
    });
  }
}

/** Delivers an operator's reply (text, photo, file, voice...) to the customer. */
export async function relayToCustomer(env: Env, msg: TgMessage, customerChatId: number): Promise<void> {
  const session = await db.getSession(env.DB, customerChatId);
  const lang = session.lang ?? 'uz';
  // The customer's next message answers the operator, not the "how many?" under a product card.
  // Only the step changes: this runs from the operators' chat, alongside the customer's own updates.
  if (session.step?.startsWith('qty?:')) await db.clearSoftStep(env.DB, customerChatId);
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
