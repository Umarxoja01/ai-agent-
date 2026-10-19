import type { Env } from './env';

// Only the parts of the Bot API this bot uses.

export interface TgUser {
  id: number;
  is_bot?: boolean;
  first_name: string;
  last_name?: string;
  username?: string;
  language_code?: string;
}

export interface TgChat {
  id: number;
  type: 'private' | 'group' | 'supergroup' | 'channel';
  title?: string;
}

export interface TgPhotoSize {
  file_id: string;
  width: number;
  height: number;
}

export interface TgMessage {
  message_id: number;
  from?: TgUser;
  chat: TgChat;
  date: number;
  text?: string;
  caption?: string;
  photo?: TgPhotoSize[];
  document?: { file_id: string; mime_type?: string };
  contact?: { phone_number: string; first_name: string; user_id?: number };
  reply_to_message?: TgMessage;
}

export interface TgCallbackQuery {
  id: string;
  from: TgUser;
  message?: TgMessage;
  data?: string;
}

export interface TgUpdate {
  update_id: number;
  message?: TgMessage;
  callback_query?: TgCallbackQuery;
}

export interface InlineButton {
  text: string;
  callback_data?: string;
  url?: string;
}

export type InlineKeyboard = InlineButton[][];

export interface ReplyKeyboard {
  keyboard: { text: string; request_contact?: boolean }[][];
  resize_keyboard?: boolean;
  is_persistent?: boolean;
  one_time_keyboard?: boolean;
}

export type ReplyMarkup = { inline_keyboard: InlineKeyboard } | ReplyKeyboard | { remove_keyboard: true };

export class TgError extends Error {
  constructor(
    readonly method: string,
    readonly code: number,
    readonly description: string,
  ) {
    super(`Telegram ${method} failed: ${code} ${description}`);
  }
}

export function inline(rows: InlineKeyboard): { inline_keyboard: InlineKeyboard } {
  return { inline_keyboard: rows };
}

/** Calls a Bot API method. Never puts the token into errors or logs. */
export async function tg<T = unknown>(env: Env, method: string, params: Record<string, unknown>): Promise<T> {
  const base = env.TELEGRAM_API || 'https://api.telegram.org';
  let res: Response;
  try {
    res = await fetch(`${base}/bot${env.BOT_TOKEN}/${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    });
  } catch (err) {
    throw new TgError(method, 0, err instanceof Error ? err.message : 'network error');
  }
  let body: { ok?: boolean; result?: T; error_code?: number; description?: string } = {};
  try {
    body = await res.json();
  } catch {
    // non-JSON body (proxy error page etc.)
  }
  if (!body.ok) throw new TgError(method, body.error_code ?? res.status, body.description ?? res.statusText);
  return body.result as T;
}

/** Telegram allows 4096 characters after entity parsing; keep a margin. */
export const TEXT_LIMIT = 4000;

/** Length of HTML-formatted text as Telegram counts it (tags removed, entities as one character). */
export function visibleLength(html: string): number {
  return html.replace(/<[^>]*>/g, '').replace(/&(amp|lt|gt|quot);/g, '_').length;
}

/**
 * Splits long HTML text on line breaks. Every tag this bot writes opens and closes on
 * the same line, so each chunk stays valid HTML.
 */
export function splitHtml(html: string, limit = TEXT_LIMIT): string[] {
  if (visibleLength(html) <= limit) return [html];
  const chunks: string[] = [];
  let current = '';
  for (const line of html.split('\n')) {
    const next = current ? `${current}\n${line}` : line;
    if (current && visibleLength(next) > limit) {
      chunks.push(current);
      current = line;
    } else {
      current = next;
    }
  }
  if (current) chunks.push(current);
  return chunks;
}

/** Sends HTML text, split into several messages when too long; the markup goes on the last one. */
export async function sendMessage(
  env: Env,
  chatId: number | string,
  text: string,
  markup?: ReplyMarkup,
  extra: Record<string, unknown> = {},
): Promise<TgMessage> {
  const chunks = splitHtml(text);
  for (const chunk of chunks.slice(0, -1)) {
    await tg<TgMessage>(env, 'sendMessage', { chat_id: chatId, text: chunk, parse_mode: 'HTML', link_preview_options: { is_disabled: true } });
  }
  return tg<TgMessage>(env, 'sendMessage', {
    chat_id: chatId,
    text: chunks.at(-1) ?? text,
    parse_mode: 'HTML',
    link_preview_options: { is_disabled: true },
    ...(markup ? { reply_markup: markup } : {}),
    ...extra,
  });
}

/** Edits a text message in place; falls back to a new message when editing is impossible. */
export async function editOrSend(
  env: Env,
  chatId: number,
  message: TgMessage | undefined,
  text: string,
  markup?: { inline_keyboard: InlineKeyboard },
): Promise<void> {
  if (message?.text !== undefined && visibleLength(text) <= TEXT_LIMIT) {
    try {
      await tg(env, 'editMessageText', {
        chat_id: chatId,
        message_id: message.message_id,
        text,
        parse_mode: 'HTML',
        link_preview_options: { is_disabled: true },
        ...(markup ? { reply_markup: markup } : {}),
      });
      return;
    } catch (err) {
      if (err instanceof TgError && /message is not modified/i.test(err.description)) return;
      // too old, deleted, or a photo message: send a fresh one below
    }
  }
  await sendMessage(env, chatId, text, markup);
}

export async function answerCallback(env: Env, id: string, text?: string, alert = false): Promise<void> {
  try {
    await tg(env, 'answerCallbackQuery', { callback_query_id: id, ...(text ? { text, show_alert: alert } : {}) });
  } catch {
    // the spinner times out on its own; nothing else depends on this
  }
}
