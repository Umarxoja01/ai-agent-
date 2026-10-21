import { describe, expect, it } from 'vitest';
import { TelegramApi, TelegramError } from '../src/telegram.js';

const TOKEN = '123456789:AAEexampleexampleexampleexample_xyz';

function fakeFetch(replies: Array<(url: string, init: any) => any>) {
  const calls: { url: string; body: any }[] = [];
  const impl = (async (url: string, init: any) => {
    calls.push({ url, body: init.body instanceof FormData ? init.body : JSON.parse(init.body) });
    const reply = replies.shift();
    if (!reply) throw new Error('no reply');
    const value = reply(url, init);
    if (value instanceof Error) throw value;
    return new Response(JSON.stringify(value), { status: value.ok ? 200 : value.error_code ?? 400 });
  }) as unknown as typeof fetch;
  return { impl, calls };
}

describe('TelegramApi', () => {
  it('refuses a malformed token', () => {
    expect(() => new TelegramApi('abc')).toThrow("BOT_TOKEN shakli noto'g'ri");
  });

  it('posts JSON and returns result', async () => {
    const { impl, calls } = fakeFetch([() => ({ ok: true, result: { message_id: 5 } })]);
    const api = new TelegramApi(TOKEN, impl);
    expect(await api.sendMessage(7, 'salom')).toEqual({ message_id: 5 });
    expect(calls[0].url).toBe(`https://api.telegram.org/bot${TOKEN}/sendMessage`);
    expect(calls[0].body).toEqual({ chat_id: 7, text: 'salom' });
  });

  it('never puts the token into an error', async () => {
    const leak = new Error(`connect ECONNREFUSED https://api.telegram.org/bot${TOKEN}/getMe`);
    const { impl } = fakeFetch([() => leak, () => ({ ok: false, error_code: 401, description: `Unauthorized ${TOKEN}` })]);
    const api = new TelegramApi(TOKEN, impl);
    const first = await api.getMe().then(() => new Error("ok"), e => e as Error);
    expect(first.message).toContain('tarmoq xatosi');
    expect(first.message).not.toContain(TOKEN);
    const second = await api.getMe().then(() => new TelegramError("x", 0, "ok"), e => e as TelegramError);
    expect(second).toBeInstanceOf(TelegramError);
    expect(second.code).toBe(401);
    expect(second.message).not.toContain(TOKEN);
  });

  it('waits and retries once on 429; "not modified" and old callbacks are not errors', async () => {
    const { impl, calls } = fakeFetch([
      () => ({ ok: false, error_code: 429, description: 'Too Many Requests', parameters: { retry_after: 0.01 } }),
      () => ({ ok: true, result: { message_id: 9 } }),
      () => ({ ok: false, error_code: 400, description: 'Bad Request: message is not modified' }),
      () => ({ ok: false, error_code: 400, description: 'Bad Request: query is too old' }),
    ]);
    const api = new TelegramApi(TOKEN, impl);
    expect(await api.sendMessage(1, 'x')).toEqual({ message_id: 9 });
    await expect(api.editMessageText(1, 9, 'x')).resolves.toBeUndefined();
    await expect(api.answerCallbackQuery('q')).resolves.toBeUndefined();
    expect(calls).toHaveLength(4);
  });

  it('sends the CSV as a multipart document', async () => {
    const { impl, calls } = fakeFetch([() => ({ ok: true, result: {} })]);
    await new TelegramApi(TOKEN, impl).sendDocument(3, 'h.csv', 'a;b\r\n', 'izoh');
    const form = calls[0].body as FormData;
    expect(form.get('chat_id')).toBe('3');
    expect(form.get('caption')).toBe('izoh');
    const file = form.get('document') as File;
    expect(file.name).toBe('h.csv');
    expect(await file.text()).toBe('a;b\r\n');
  });
});
