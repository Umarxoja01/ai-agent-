// ===================================================================
// FERMER BOT - TELEGRAM BOT API (to'g'ridan-to'g'ri, kutubxonasiz)
// ===================================================================
// Token faqat URL ichida ishlatiladi; xato matnlariga hech qachon
// tushmaydi (redact). Long polling: getUpdates timeout bilan.
// ===================================================================

export interface TgUser { id: number; is_bot?: boolean; first_name?: string; last_name?: string; username?: string }
export interface TgChat { id: number; type: string }
export interface TgMessage {
  message_id: number;
  from?: TgUser;
  chat: TgChat;
  date: number;
  text?: string;
}
export interface TgCallback { id: string; from: TgUser; message?: TgMessage; data?: string }
export interface TgUpdate { update_id: number; message?: TgMessage; callback_query?: TgCallback }

export interface InlineButton { text: string; callback_data: string }
export interface InlineKeyboard { inline_keyboard: InlineButton[][] }
export interface ReplyKeyboard { keyboard: { text: string }[][]; resize_keyboard?: boolean; is_persistent?: boolean }
export type ReplyMarkup = InlineKeyboard | ReplyKeyboard | { remove_keyboard: true };

/** Bot faqat shu to'rt amalni ishlatadi - testda soxta API bilan almashtiriladi. */
export interface BotApi {
  sendMessage(chatId: number, text: string, markup?: ReplyMarkup): Promise<{ message_id: number }>;
  editMessageText(chatId: number, messageId: number, text: string, markup?: InlineKeyboard): Promise<void>;
  answerCallbackQuery(id: string, text?: string): Promise<void>;
  sendDocument(chatId: number, filename: string, content: string, caption?: string): Promise<void>;
}

export class TelegramError extends Error {
  constructor(readonly method: string, readonly code: number, readonly description: string, readonly retryAfter?: number) {
    super(`Telegram ${method}: ${code} ${description}`);
  }
}

type Fetch = typeof fetch;

export class TelegramApi implements BotApi {
  /** apiBase - faqat sinov yoki o'z Bot API serveri uchun (standart: api.telegram.org). */
  constructor(private readonly token: string, private readonly fetchImpl: Fetch = fetch, private readonly apiBase = 'https://api.telegram.org') {
    if (!/^\d{5,15}:[A-Za-z0-9_-]{30,}$/.test(token)) throw new Error("BOT_TOKEN shakli noto'g'ri (kutilgan: 123456789:ABC...).");
  }

  private redact(text: string): string {
    return text.split(this.token).join('***');
  }

  async call<T = any>(method: string, body: Record<string, unknown> | FormData = {}, timeoutMs = 30_000): Promise<T> {
    let response: Response;
    try {
      response = await this.fetchImpl(`${this.apiBase}/bot${this.token}/${method}`, {
        method: 'POST',
        ...(body instanceof FormData ? { body } : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (error) {
      const message = error instanceof Error ? `${error.message}${(error as any).cause?.message ? ` (${(error as any).cause.message})` : ''}` : String(error);
      throw new Error(this.redact(`Telegram ${method}: tarmoq xatosi - ${message}`));
    }
    const data = await response.json().catch(() => ({})) as { ok?: boolean; result?: T; error_code?: number; description?: string; parameters?: { retry_after?: number } };
    if (!data.ok) throw new TelegramError(method, data.error_code ?? response.status, this.redact(data.description ?? response.statusText), data.parameters?.retry_after);
    return data.result as T;
  }

  /** 429 bo'lsa bir marta kutib qayta yuboradi. */
  private async send<T>(method: string, body: Record<string, unknown> | FormData): Promise<T> {
    try {
      return await this.call<T>(method, body);
    } catch (error) {
      if (error instanceof TelegramError && error.code === 429 && error.retryAfter && error.retryAfter <= 30) {
        await new Promise(resolve => setTimeout(resolve, error.retryAfter! * 1000));
        return this.call<T>(method, body);
      }
      throw error;
    }
  }

  getMe() { return this.call<TgUser & { username: string }>('getMe'); }

  getUpdates(offset: number, timeoutSeconds: number): Promise<TgUpdate[]> {
    return this.call<TgUpdate[]>('getUpdates', { offset, timeout: timeoutSeconds, allowed_updates: ['message', 'callback_query'] }, (timeoutSeconds + 15) * 1000);
  }

  setMyCommands(commands: { command: string; description: string }[]) {
    return this.call('setMyCommands', { commands });
  }

  sendMessage(chatId: number, text: string, markup?: ReplyMarkup) {
    return this.send<{ message_id: number }>('sendMessage', { chat_id: chatId, text, ...(markup ? { reply_markup: markup } : {}) });
  }

  async editMessageText(chatId: number, messageId: number, text: string, markup?: InlineKeyboard) {
    try {
      await this.send('editMessageText', { chat_id: chatId, message_id: messageId, text, ...(markup ? { reply_markup: markup } : {}) });
    } catch (error) {
      // bir xil matn bilan qayta bosilgan tugma - xato emas
      if (error instanceof TelegramError && /message is not modified/i.test(error.description)) return;
      throw error;
    }
  }

  async answerCallbackQuery(id: string, text?: string) {
    try {
      await this.call('answerCallbackQuery', { callback_query_id: id, ...(text ? { text } : {}) });
    } catch (error) {
      // eski (muddati o'tgan) tugma bosilishi - javob shart emas
      if (error instanceof TelegramError && error.code === 400) return;
      throw error;
    }
  }

  async sendDocument(chatId: number, filename: string, content: string, caption?: string) {
    const form = new FormData();
    form.set('chat_id', String(chatId));
    if (caption) form.set('caption', caption);
    form.set('document', new Blob([content], { type: 'text/csv' }), filename);
    await this.send('sendDocument', form);
  }
}
