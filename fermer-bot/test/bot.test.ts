import { beforeEach, describe, expect, it } from 'vitest';
import { createBot, tashkentToday } from '../src/bot.js';
import { Store } from '../src/db.js';
import { MAIN_KEYBOARD, TEXT } from '../src/texts.js';
import { buttons, fakeApi, msg, press } from './helpers.js';

// 2026-10-21 12:00 Toshkent
const NOW = new Date('2026-10-21T07:00:00Z');
const ALI = 1001;
const VALI = 2002;

let store: Store;
let tg: ReturnType<typeof fakeApi>;
let bot: ReturnType<typeof createBot>;

beforeEach(() => {
  store = new Store(':memory:', () => NOW);
  tg = fakeApi();
  bot = createBot({ store, api: tg.api, now: () => NOW, adminIds: [ALI] });
});

async function onboard(userId: number, farm = 'Baraka fermasi') {
  await bot.handleUpdate(msg(userId, '/start'));
  await bot.handleUpdate(msg(userId, farm));
}
/** Oxirgi kartani bosadi. */
async function pressLast(userId: number, data: string) {
  const card = [...tg.sent].reverse().find(s => s.chatId === userId && buttons(s.markup).length)!;
  await bot.handleUpdate(press(userId, card.id, data, card.text));
}

describe('Toshkent sanasi', () => {
  it('UTC+5: kechki 20:00 UTC - ertangi kun', () => {
    expect(tashkentToday(new Date('2026-10-21T18:59:00Z'))).toBe('2026-10-21');
    expect(tashkentToday(new Date('2026-10-21T19:00:00Z'))).toBe('2026-10-22');
  });
});

describe('onboarding', () => {
  it('/start asks the farm name, saves it and shows the menu', async () => {
    await bot.handleUpdate(msg(ALI, '/start'));
    expect(tg.last().text).toContain('fermangiz nomini yozing');
    await bot.handleUpdate(msg(ALI, 'x'));
    expect(tg.last().text).toBe(TEXT.farmNameBad);
    await bot.handleUpdate(msg(ALI, 'Baraka fermasi'));
    expect(store.farmer(ALI)?.farmName).toBe('Baraka fermasi');
    expect(tg.last().markup).toEqual(MAIN_KEYBOARD);
  });

  it('a first message that is not /start still starts onboarding', async () => {
    await bot.handleUpdate(msg(ALI, 'yem 900 ming'));
    expect(tg.last().text).toContain('fermangiz nomini yozing');
    expect(store.entries(ALI)).toEqual([]);
  });

  it('groups are refused, bots ignored', async () => {
    await bot.handleUpdate(msg(ALI, '/start', 'group'));
    expect(tg.last().text).toBe(TEXT.privateOnly);
    expect(store.farmer(ALI)).toBeUndefined();
  });
});

describe('yozuvlar faqat tasdiq bilan saqlanadi', () => {
  it('milk via the menu button: number -> card -> ✅ -> saved with the month total', async () => {
    await onboard(ALI);
    await bot.handleUpdate(msg(ALI, "🥛 Sut sog'imi"));
    expect(tg.last().text).toBe(TEXT.askMilk);
    await bot.handleUpdate(msg(ALI, '85,5'));
    expect(tg.last().text).toBe("Tekshiring:\n\n🥛 Sut sog'imi: 85,5 litr\nSana: 21-oktabr 2026 (bugun)");
    expect(buttons(tg.last().markup)).toEqual(['ok', 'no']);
    expect(store.entries(ALI)).toEqual([]);
    await pressLast(ALI, 'ok');
    expect(store.entries(ALI)).toMatchObject([{ kind: 'milk', qty: 85.5, unit: 'l', date: '2026-10-21' }]);
    expect(tg.lastEdit().text).toContain('✅ Saqlandi.');
    expect(tg.lastEdit().text).toContain("Bu oy sog'ilgan: 85,5 litr");
  });

  it('Cyrillic menu text and "kecha 80" work', async () => {
    await onboard(ALI);
    await bot.handleUpdate(msg(ALI, 'Сут соғими'));
    await bot.handleUpdate(msg(ALI, 'кеча 80'));
    expect(tg.last().text).toContain('80 litr\nSana: 20-oktabr 2026');
  });

  it('free text expense, change category on the card, then save', async () => {
    await onboard(ALI);
    await bot.handleUpdate(msg(ALI, "Yemga 900 ming so'm to'ladim"));
    expect(tg.last().text).toContain("💸 Xarajat - Yem-xashak\nSumma: 900 000 so'm");
    expect(buttons(tg.last().markup)).toEqual(['ok', 'no', 'cat']);
    await pressLast(ALI, 'cat');
    expect(buttons(tg.lastEdit().markup)).toContain('c:vet');
    const card = tg.lastEdit();
    await bot.handleUpdate(press(ALI, card.id, 'c:vet'));
    expect(tg.lastEdit().text).toContain('Veterinar, dori');
    await bot.handleUpdate(press(ALI, card.id, 'ok'));
    expect(store.entries(ALI)).toMatchObject([{ kind: 'expense', category: 'vet', amount: 900_000 }]);
    expect(tg.lastEdit().text).toContain("Bu oy: daromad 0, xarajat 900 000, zarar 900 000 so'm");
  });

  it('a milk sale shows qty x price computed by code', async () => {
    await onboard(ALI);
    await bot.handleUpdate(msg(ALI, '120 litr sut sotdim, litri 6000'));
    expect(tg.last().text).toContain("💰 Daromad - Sut sotuvi\n120 litr × 6 000 = 720 000 so'm");
    await pressLast(ALI, 'ok');
    expect(store.entries(ALI)).toMatchObject([{ kind: 'income', category: 'milk', qty: 120, unitPrice: 6000, amount: 720_000 }]);
  });

  it('button flow: Xarajat -> category -> amount', async () => {
    await onboard(ALI);
    await bot.handleUpdate(msg(ALI, '💸 Xarajat'));
    expect(buttons(tg.last().markup)).toEqual(['c:feed', 'c:vet', 'c:labor', 'c:transport', 'c:utilities', 'c:animal', 'c:other', 'sw', 'no']);
    await pressLast(ALI, 'c:labor');
    expect(tg.lastEdit().text).toContain('Ish haqi: summani yozing');
    await bot.handleUpdate(msg(ALI, 'abc'));
    expect(tg.last().text).toBe(TEXT.amountBad);
    await bot.handleUpdate(msg(ALI, '1,2 mln'));
    expect(tg.last().text).toContain("Ish haqi\nSumma: 1 200 000 so'm");
  });

  it('the category keyboard can switch expense <-> income', async () => {
    await onboard(ALI);
    await bot.handleUpdate(msg(ALI, "to'lov 500 ming"));
    await pressLast(ALI, 'k:expense');
    const card = tg.lastEdit();
    expect(buttons(card.markup)).toContain('sw');
    await bot.handleUpdate(press(ALI, card.id, 'sw'));
    expect(buttons(tg.lastEdit().markup)).toEqual(['c:milk', 'c:animal', 'c:meat', 'c:manure', 'c:other', 'sw', 'no']);
    await bot.handleUpdate(press(ALI, card.id, 'c:other'));
    await bot.handleUpdate(press(ALI, card.id, 'ok'));
    expect(store.entries(ALI)).toMatchObject([{ kind: 'income', category: 'other', amount: 500_000 }]);
  });

  it('plain words ask for a report', async () => {
    await onboard(ALI);
    await bot.handleUpdate(msg(ALI, "o'tgan oy hisoboti"));
    expect(tg.last().text).toContain('Sentabr 2026');
    await bot.handleUpdate(msg(ALI, 'bu yil foyda qancha'));
    expect(tg.last().text).toContain('2026-yil');
  });

  it('a bare number asks what it is', async () => {
    await onboard(ALI);
    await bot.handleUpdate(msg(ALI, '900 ming'));
    expect(buttons(tg.last().markup)).toEqual(['k:milk', 'k:income', 'k:expense', 'no']);
    await pressLast(ALI, 'k:expense');
    const card = tg.lastEdit();
    await bot.handleUpdate(press(ALI, card.id, 'c:feed'));
    expect(tg.lastEdit().text).toContain("Yem-xashak\nSumma: 900 000 so'm");
  });

  it('❌ cancels, a future date is refused', async () => {
    await onboard(ALI);
    await bot.handleUpdate(msg(ALI, 'yem 900 ming'));
    await pressLast(ALI, 'no');
    expect(tg.lastEdit().text).toBe(TEXT.cancelled);
    await bot.handleUpdate(msg(ALI, '25.10 yem 900 ming'));
    expect(tg.last().text).toContain('Sana kelajakda');
    expect(store.entries(ALI)).toEqual([]);
  });

  it('an old card is stale; pressing ✅ twice saves once', async () => {
    await onboard(ALI);
    await bot.handleUpdate(msg(ALI, 'yem 900 ming'));
    const first = tg.last();
    await bot.handleUpdate(msg(ALI, 'veterinarga 150 ming'));
    const second = tg.last();
    await bot.handleUpdate(press(ALI, first.id, 'ok', first.text));
    expect(tg.answers.at(-1)?.text).toBe(TEXT.stale);
    expect(store.entries(ALI)).toEqual([]);
    await bot.handleUpdate(press(ALI, second.id, 'ok'));
    await bot.handleUpdate(press(ALI, second.id, 'ok'));
    expect(store.entries(ALI)).toMatchObject([{ category: 'vet', amount: 150_000 }]);
  });
});

describe('fermerlar bir-biridan ajratilgan', () => {
  it("another farmer cannot press Ali's card, see his report or undo his entry", async () => {
    await onboard(ALI);
    await onboard(VALI, 'Vali fermasi');
    await bot.handleUpdate(msg(ALI, 'yem 900 ming'));
    const card = tg.last();
    await bot.handleUpdate(press(VALI, card.id, 'ok'));
    expect(store.entries(ALI)).toEqual([]);
    await bot.handleUpdate(press(ALI, card.id, 'ok'));
    expect(store.entries(ALI)).toHaveLength(1);

    await bot.handleUpdate(msg(VALI, '/hisobot'));
    expect(tg.last().text).toContain("Bu davrda yozuv yo'q.");
    await bot.handleUpdate(msg(VALI, "↩️ Oxirgisini o'chirish"));
    expect(tg.last().text).toBe(TEXT.nothingToUndo);
    const aliEntry = store.lastEntry(ALI)!;
    await bot.handleUpdate(press(VALI, card.id, `u:${aliEntry.id}`));
    expect(store.entries(ALI)).toHaveLength(1);
  });
});

describe('hisobot, o\'chirish, eksport', () => {
  it('report for this month, then last month via the button', async () => {
    await onboard(ALI);
    await bot.handleUpdate(msg(ALI, '120 litr sut sotdim, litri 6000'));
    await pressLast(ALI, 'ok');
    await bot.handleUpdate(msg(ALI, 'yem 900 ming'));
    await pressLast(ALI, 'ok');
    await bot.handleUpdate(msg(ALI, '📊 Hisobot'));
    const report = tg.last();
    expect(report.text).toContain('Baraka fermasi - Oktabr 2026 (1-21)');
    expect(report.text).toContain("💰 Daromad: 720 000 so'm");
    expect(report.text).toContain("💸 Xarajat: 900 000 so'm");
    expect(report.text).toContain("🔻 Zarar: 180 000 so'm");
    expect(buttons(report.markup)).toEqual(['r:this_month', 'r:last_month', 'r:this_year']);
    await bot.handleUpdate(press(ALI, report.id, 'r:last_month'));
    expect(tg.lastEdit().text).toContain('Sentabr 2026');
    expect(tg.lastEdit().text).toContain("Bu davrda yozuv yo'q.");
  });

  it('undo the last entry', async () => {
    await onboard(ALI);
    await bot.handleUpdate(msg(ALI, 'yem 900 ming'));
    await pressLast(ALI, 'ok');
    await bot.handleUpdate(msg(ALI, "↩️ Oxirgisini o'chirish"));
    expect(tg.last().text).toContain("Shu yozuvni o'chiraymi?");
    const id = store.lastEntry(ALI)!.id;
    await pressLast(ALI, `u:${id}`);
    expect(tg.lastEdit().text).toBe(TEXT.undone);
    expect(store.entries(ALI)).toEqual([]);
  });

  it('/export sends a CSV, /delete_me removes everything after confirmation', async () => {
    await onboard(ALI);
    await bot.handleUpdate(msg(ALI, '/export'));
    expect(tg.last().text).toBe(TEXT.exportEmpty);
    await bot.handleUpdate(msg(ALI, 'yem 900 ming'));
    await pressLast(ALI, 'ok');
    await bot.handleUpdate(msg(ALI, '/export'));
    expect(tg.docs[0]).toMatchObject({ chatId: ALI, filename: 'fermer-hisob-2026-10-21.csv' });
    expect(tg.docs[0].content).toContain('2026-10-21;Xarajat;Yem-xashak;;;;900000;');

    await bot.handleUpdate(msg(ALI, '/delete_me'));
    await pressLast(ALI, 'dm:yes');
    expect(tg.lastEdit().text).toContain('1 ta yozuv');
    expect(store.farmer(ALI)).toBeUndefined();
    expect(store.entries(ALI)).toEqual([]);
  });

  it('/stats only for admins, and counts only', async () => {
    await onboard(ALI);
    await onboard(VALI);
    await bot.handleUpdate(msg(VALI, '/stats'));
    expect(tg.last().text).not.toContain('Fermerlar:');
    await bot.handleUpdate(msg(ALI, '/stats'));
    expect(tg.last().text).toBe('Fermerlar: 2 (7 kunda faol: 2)\nYozuvlar: 0 (7 kunda: 0)');
  });
});

describe('himoya', () => {
  it('too many messages in a minute: one warning, then silence', async () => {
    const limited = createBot({ store, api: tg.api, now: () => NOW, rateLimit: 3 });
    for (let i = 0; i < 6; i++) await limited.handleUpdate(msg(ALI, '/yordam'));
    expect(tg.sent.map(s => s.text).filter(t => t === TEXT.tooFast)).toHaveLength(1);
    expect(tg.sent).toHaveLength(4);
  });

  it('an API failure becomes an error reply, not a crash', async () => {
    await onboard(ALI);
    const broken = { ...tg.api, sendDocument: async () => { throw new Error('Telegram sendDocument: 500 boom'); } };
    const logs: string[] = [];
    const b = createBot({ store, api: broken, now: () => NOW, log: l => logs.push(l) });
    await bot.handleUpdate(msg(ALI, 'yem 900 ming'));
    await pressLast(ALI, 'ok');
    await b.handleUpdate(msg(ALI, '/export'));
    expect(tg.last().text).toBe(TEXT.error);
    expect(logs[0]).toContain('500 boom');
    expect(logs[0]).not.toContain('yem');
  });
});
