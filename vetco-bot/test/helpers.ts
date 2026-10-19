import { createExecutionContext, env, waitOnExecutionContext } from 'cloudflare:test';
import { vi } from 'vitest';
import worker from '../src/index';
import type { TgUpdate } from '../src/tg';

export const SECRET = 'test-secret-0123456789';
export const ADMIN_CHAT = -100777;

export interface Call {
  method: string;
  params: Record<string, any>;
}

export interface MockOptions {
  csv?: string;
  /** Return an error description (or a full error body) to make that Telegram call fail. */
  fail?: (method: string, params: Record<string, any>) => string | { description: string; parameters?: object } | undefined;
  sheets?: (body: any) => Response;
}

/** Replaces fetch: records Bot API calls and answers like Telegram would. */
export function mockNetwork(opts: MockOptions = {}) {
  const calls: Call[] = [];
  const sheetBodies: any[] = [];
  let nextMessageId = 5000;
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (url.startsWith('https://tg.test/bot')) {
      const method = url.split('/').pop()!;
      const params = init?.body ? JSON.parse(String(init.body)) : {};
      calls.push({ method, params });
      const error = opts.fail?.(method, params);
      if (typeof error === 'string') return Response.json({ ok: false, error_code: 400, description: error });
      if (error) return Response.json({ ok: false, error_code: 400, ...error });
      let result: unknown = true;
      if (method === 'sendMessage' || method === 'sendPhoto' || method === 'copyMessage') {
        result = { message_id: ++nextMessageId, chat: { id: params.chat_id, type: 'private' }, date: 0, text: params.text };
      } else if (method === 'getMe') {
        result = { id: 1, is_bot: true, first_name: 'VETCO', username: 'vetco_test_bot' };
      } else if (method === 'getChat') {
        result = { id: params.chat_id, type: 'supergroup', title: 'VETCO buyurtmalar' };
      } else if (method === 'getFile') {
        result = { file_id: params.file_id, file_path: 'photos/file_1.jpg' };
      }
      return Response.json({ ok: true, result });
    }
    if (url.startsWith('https://tg.test/file/')) return new Response('JPEGDATA');
    if (url === 'https://sheet.test/catalog.csv') {
      return opts.csv === undefined ? new Response('missing', { status: 404 }) : new Response(opts.csv);
    }
    if (url.startsWith('https://sheets.test/')) {
      const body = JSON.parse(String(init?.body));
      sheetBodies.push(body);
      return opts.sheets ? opts.sheets(body) : Response.json({ ok: true });
    }
    throw new Error(`unexpected fetch: ${url}`);
  });
  return {
    calls,
    sheetBodies,
    of: (method: string) => calls.filter((c) => c.method === method),
    texts: (chatId: number) =>
      calls
        .filter((c) => String(c.params.chat_id) === String(chatId) && (c.params.text || c.params.caption))
        .map((c) => String(c.params.text ?? c.params.caption)),
    lastTo: (chatId: number) => [...calls].reverse().find((c) => String(c.params.chat_id) === String(chatId) && (c.params.text || c.params.caption)),
    clear: () => (calls.length = 0),
  };
}

export type Net = ReturnType<typeof mockNetwork>;

let updateId = Math.floor(Math.random() * 1e6) * 100;
let messageId = 1;

export function nextUpdateId(): number {
  return ++updateId;
}

export function user(id: number, extra: Record<string, unknown> = {}) {
  return { id, is_bot: false, first_name: 'Ali', last_name: 'Valiyev', username: `user${id}`, ...extra };
}

export function textUpdate(chatId: number, text: string, extra: Record<string, unknown> = {}, fromId = chatId): TgUpdate {
  return {
    update_id: nextUpdateId(),
    message: {
      message_id: ++messageId,
      from: user(fromId),
      chat: { id: chatId, type: chatId < 0 ? 'supergroup' : 'private' },
      date: 0,
      text,
      ...extra,
    } as any,
  };
}

export function messageUpdate(chatId: number, message: Record<string, unknown>, fromId = chatId): TgUpdate {
  return {
    update_id: nextUpdateId(),
    message: {
      message_id: ++messageId,
      from: user(fromId),
      chat: { id: chatId, type: chatId < 0 ? 'supergroup' : 'private' },
      date: 0,
      ...message,
    } as any,
  };
}

export function callbackUpdate(chatId: number, data: string, fromId = chatId, messageText = 'old'): TgUpdate {
  return {
    update_id: nextUpdateId(),
    callback_query: {
      id: `cb${updateId}`,
      from: user(fromId),
      data,
      message: {
        message_id: ++messageId,
        chat: { id: chatId, type: chatId < 0 ? 'supergroup' : 'private' },
        date: 0,
        text: messageText,
      },
    },
  };
}

export async function call(request: Request): Promise<Response> {
  const ctx = createExecutionContext();
  const res = await worker.fetch(request, env, ctx);
  await waitOnExecutionContext(ctx);
  return res;
}

export async function deliver(update: TgUpdate, secret = SECRET): Promise<Response> {
  return call(
    new Request('https://bot.test/telegram', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Telegram-Bot-Api-Secret-Token': secret },
      body: JSON.stringify(update),
    }),
  );
}

export function api(path: string, init: RequestInit = {}, token = 'admin-token'): Promise<Response> {
  return call(
    new Request(`https://bot.test${path}`, {
      ...init,
      headers: { Authorization: `Bearer ${token}`, ...(init.headers ?? {}) },
    }),
  );
}

/** Inline keyboard callback_data values of a Bot API call. */
export function buttons(c: Call | undefined): string[] {
  const rows = c?.params.reply_markup?.inline_keyboard ?? [];
  return rows.flat().map((b: any) => b.callback_data ?? b.url);
}

/** Puts a user through language choice so the session has a language. */
export async function onboard(chatId: number, lang: 'uz' | 'ru' = 'uz'): Promise<void> {
  await deliver(textUpdate(chatId, '/start'));
  await deliver(callbackUpdate(chatId, `l:${lang}`));
}
