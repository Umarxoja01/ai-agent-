import type { BotApi, InlineKeyboard, ReplyMarkup, TgUpdate } from '../src/telegram.js';

export interface Sent { chatId: number; id: number; text: string; markup?: ReplyMarkup }

/** Soxta Telegram: yuborilgan, tahrirlangan xabarlar va hujjatlarni yozib boradi. */
export function fakeApi() {
  let nextId = 100;
  const sent: Sent[] = [];
  const edits: Sent[] = [];
  const answers: { id: string; text?: string }[] = [];
  const docs: { chatId: number; filename: string; content: string; caption?: string }[] = [];
  const api: BotApi = {
    async sendMessage(chatId, text, markup) { const id = nextId++; sent.push({ chatId, id, text, markup }); return { message_id: id }; },
    async editMessageText(chatId, id, text, markup?: InlineKeyboard) { edits.push({ chatId, id, text, markup }); },
    async answerCallbackQuery(id, text) { answers.push({ id, text }); },
    async sendDocument(chatId, filename, content, caption) { docs.push({ chatId, filename, content, caption }); },
  };
  return { api, sent, edits, answers, docs, last: () => sent[sent.length - 1], lastEdit: () => edits[edits.length - 1] };
}

let updateId = 1;
export function msg(userId: number, text: string, chatType = 'private'): TgUpdate {
  return { update_id: updateId++, message: { message_id: updateId, from: { id: userId, first_name: `Fermer${userId}` }, chat: { id: chatType === 'private' ? userId : -userId, type: chatType }, date: 0, text } };
}
export function press(userId: number, messageId: number, data: string, text = ''): TgUpdate {
  return { update_id: updateId++, callback_query: { id: `cb${updateId}`, from: { id: userId }, data, message: { message_id: messageId, chat: { id: userId, type: 'private' }, date: 0, text } } };
}
/** Inline tugmalar callback_data ro'yxati. */
export function buttons(markup?: ReplyMarkup): string[] {
  return markup && 'inline_keyboard' in markup ? markup.inline_keyboard.flat().map(b => b.callback_data) : [];
}
