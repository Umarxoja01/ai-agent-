// ===================================================================
// FERMER BOT - O'ZBEKCHA MATNLAR VA TUGMALAR
// ===================================================================

import type { ExpenseCategory, IncomeCategory, Kind } from './parse.js';

export const INCOME_LABELS: Record<IncomeCategory, string> = {
  milk: 'Sut sotuvi',
  animal: 'Mol sotuvi',
  meat: "Go'sht",
  manure: "Go'ng",
  other: 'Boshqa daromad',
};

export const EXPENSE_LABELS: Record<ExpenseCategory, string> = {
  feed: 'Yem-xashak',
  vet: 'Veterinar, dori',
  labor: 'Ish haqi',
  transport: "Transport, yoqilg'i",
  utilities: 'Svet, gaz, suv',
  animal: 'Mol sotib olish',
  other: 'Boshqa xarajat',
};

export const KIND_LABELS: Record<Kind, string> = {
  milk: "🥛 Sut sog'imi",
  income: '💰 Daromad',
  expense: '💸 Xarajat',
};

export function categoryLabel(kind: Kind, category: string | null | undefined): string {
  if (kind === 'income') return INCOME_LABELS[category as IncomeCategory] ?? INCOME_LABELS.other;
  if (kind === 'expense') return EXPENSE_LABELS[category as ExpenseCategory] ?? EXPENSE_LABELS.other;
  return "Sut sog'imi";
}

export const MONTHS = ['Yanvar', 'Fevral', 'Mart', 'Aprel', 'May', 'Iyun', 'Iyul', 'Avgust', 'Sentabr', 'Oktabr', 'Noyabr', 'Dekabr'];

/** "2026-10-05" -> "5-oktabr 2026" */
export function dateLabel(date: string): string {
  const [y, m, d] = date.split('-').map(Number);
  return `${d}-${MONTHS[m - 1].toLowerCase()} ${y}`;
}

// ---------------- asosiy menyu ----------------

export const BTN = {
  milk: "🥛 Sut sog'imi",
  income: '💰 Daromad',
  expense: '💸 Xarajat',
  report: '📊 Hisobot',
  undo: "↩️ Oxirgisini o'chirish",
  help: '❓ Yordam',
} as const;

export const MAIN_KEYBOARD = {
  keyboard: [
    [{ text: BTN.milk }, { text: BTN.income }],
    [{ text: BTN.expense }, { text: BTN.report }],
    [{ text: BTN.undo }, { text: BTN.help }],
  ],
  resize_keyboard: true,
  is_persistent: true,
};

export const TEXT = {
  welcome: (name: string) => [
    `Assalomu alaykum${name ? `, ${name}` : ''}! Men fermer hisobchisiman.`,
    "Sut, daromad va xarajatni yozib boraman, oy oxirida foyda-zararni hisoblab beraman.",
    "Ma'lumotlaringiz faqat sizga ko'rinadi.",
    '',
    'Avval fermangiz nomini yozing (masalan: "Baraka fermasi"):',
  ].join('\n'),
  farmNameBad: "Nomni 2-60 harf bilan yozing (masalan: \"Baraka fermasi\").",
  farmSaved: (farm: string) => `"${farm}" saqlandi. Endi pastdagi tugmalardan foydalaning yoki oddiy yozing, masalan:\n${EXAMPLES}`,
  help: () => [
    'Pastdagi tugmalar bilan yoki oddiy yozib kiriting. Misollar:',
    EXAMPLES,
    '',
    "Har yozuv avval tasdiq kartasida ko'rsatiladi - ✅ bosmaguningizcha saqlanmaydi.",
    '',
    'Buyruqlar:',
    '/hisobot - shu oy hisobi',
    '/export - hamma yozuvlar CSV faylda (Excel ochadi)',
    "/delete_me - hamma ma'lumotimni o'chir",
    "/bekor - boshlangan ishni bekor qilish",
  ].join('\n'),
  askMilk: "Bugun necha litr sut sog'ildi? Faqat raqam yozing (masalan: 85).\nBoshqa kun uchun: \"kecha 80\" yoki \"15.10 80\".",
  milkBad: "Litrni raqam bilan yozing, masalan: 85 yoki 85,5.",
  chooseIncome: 'Qanday daromad?',
  chooseExpense: 'Qanday xarajat?',
  askAmount: (kind: Kind, category: string) => kind === 'income' && category === 'milk'
    ? "Qancha sotdingiz? Masalan: \"120 litr, litri 6000\" yoki jami summa: \"720 ming\"."
    : `${categoryLabel(kind, category)}: summani yozing. Masalan: 900000, "900 ming" yoki "1,2 mln".`,
  amountBad: "Summani tushunmadim. Bitta summa yozing (\"900 ming\") yoki miqdor va narx (\"120 litr, litri 6000\").",
  amountTooBig: "Summa juda katta - qayta tekshirib yozing.",
  notUnderstood: [
    "Tushunmadim. Pastdagi tugmalardan foydalaning yoki shunday yozing:",
    '',
  ].join('\n'),
  saved: '✅ Saqlandi.',
  cancelled: '❌ Bekor qilindi, hech narsa saqlanmadi.',
  stale: 'Bu karta eskirgan.',
  nothingToUndo: "O'chirish uchun yozuv yo'q.",
  undoAsk: "Shu yozuvni o'chiraymi?",
  undone: "🗑 O'chirildi.",
  chooseReport: 'Qaysi davr hisobi?',
  noEntries: "Bu davrda yozuv yo'q.",
  exportEmpty: "Hali yozuv yo'q - eksport qilinadigan narsa yo'q.",
  deleteMeAsk: "Hamma yozuvlaringiz va fermangiz nomi BUTUNLAY o'chadi, qaytarib bo'lmaydi. O'chiraymi?",
  deletedMe: (n: number) => `Hamma ma'lumotingiz o'chirildi (${n} ta yozuv). Qaytadan boshlash uchun /start bosing.`,
  privateOnly: 'Bu bot faqat shaxsiy chatda ishlaydi.',
  tooFast: "Juda tez yozyapsiz - bir daqiqa kutib, qayta yozing.",
  error: "Xatolik bo'ldi, qayta urinib ko'ring. Takrorlansa, /bekor bosing.",
};

export const EXAMPLES = [
  "• Bugun 85 litr sut sog'dik",
  "• 120 litr sut sotdim, litri 6000",
  "• Yemga 900 ming to'ladim",
  "• Veterinarga 150 ming",
  '• Buzoq sotdim 6 mln',
].join('\n');
