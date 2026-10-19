export type Lang = 'uz' | 'ru';

export const LANGS: Lang[] = ['uz', 'ru'];

export function isLang(value: unknown): value is Lang {
  return value === 'uz' || value === 'ru';
}

export const REGIONS: { key: string; uz: string; ru: string }[] = [
  { key: 'tsh', uz: 'Toshkent shahri', ru: 'г. Ташкент' },
  { key: 'tsv', uz: 'Toshkent viloyati', ru: 'Ташкентская обл.' },
  { key: 'and', uz: 'Andijon viloyati', ru: 'Андижанская обл.' },
  { key: 'bux', uz: 'Buxoro viloyati', ru: 'Бухарская обл.' },
  { key: 'fer', uz: 'Fargʻona viloyati', ru: 'Ферганская обл.' },
  { key: 'jiz', uz: 'Jizzax viloyati', ru: 'Джизакская обл.' },
  { key: 'xor', uz: 'Xorazm viloyati', ru: 'Хорезмская обл.' },
  { key: 'nam', uz: 'Namangan viloyati', ru: 'Наманганская обл.' },
  { key: 'nav', uz: 'Navoiy viloyati', ru: 'Навоийская обл.' },
  { key: 'qash', uz: 'Qashqadaryo viloyati', ru: 'Кашкадарьинская обл.' },
  { key: 'qqr', uz: 'Qoraqalpogʻiston Respublikasi', ru: 'Республика Каракалпакстан' },
  { key: 'sam', uz: 'Samarqand viloyati', ru: 'Самаркандская обл.' },
  { key: 'sir', uz: 'Sirdaryo viloyati', ru: 'Сырдарьинская обл.' },
  { key: 'sur', uz: 'Surxondaryo viloyati', ru: 'Сурхандарьинская обл.' },
];

export function regionName(key: string, lang: Lang): string {
  const r = REGIONS.find((x) => x.key === key);
  return r ? r[lang] : key;
}

export type Status = 'new' | 'confirmed' | 'shipped' | 'delivered' | 'cancelled';

export const STATUS: Record<Status, Record<Lang, string>> = {
  new: { uz: '🆕 Qabul qilindi', ru: '🆕 Принят' },
  confirmed: { uz: '✅ Tasdiqlandi', ru: '✅ Подтверждён' },
  shipped: { uz: '🚚 Yoʻlda', ru: '🚚 В пути' },
  delivered: { uz: '📬 Yetkazildi', ru: '📬 Доставлен' },
  cancelled: { uz: '❌ Bekor qilindi', ru: '❌ Отменён' },
};

/** Reply-keyboard labels; matched in both languages so a stale keyboard keeps working. */
export const MENU = {
  catalog: { uz: '🛒 Katalog', ru: '🛒 Каталог' },
  cart: { uz: '🧺 Savat', ru: '🧺 Корзина' },
  orders: { uz: '📦 Buyurtmalarim', ru: '📦 Мои заказы' },
  contact: { uz: '📞 Aloqa', ru: '📞 Контакты' },
  lang: { uz: '🌐 Til / Язык', ru: '🌐 Til / Язык' },
} as const;

export type MenuKey = keyof typeof MENU;

export function menuKeyOf(text: string): MenuKey | null {
  const t = text.trim();
  for (const key of Object.keys(MENU) as MenuKey[]) {
    if (MENU[key].uz === t || MENU[key].ru === t) return key;
  }
  return null;
}

const uz = {
  chooseLang: 'Tilni tanlang / Выберите язык:',
  langSaved: 'Til: oʻzbekcha ✅',
  welcome:
    'Assalomu alaykum! <b>VETCO</b> — chorva uchun veterinariya preparatlari.\n\n' +
    'Bu yerda katalogni koʻrib, buyurtma berishingiz mumkin. Pastdagi menyudan foydalaning 👇',
  catalogTitle: 'Boʻlimni tanlang:',
  catalogEmpty: 'Katalog hozircha boʻsh. Keyinroq urinib koʻring yoki operatorga yozing.',
  categoryTitle: (name: string) => `<b>${name}</b>\nPreparatni tanlang:`,
  back: '⬅️ Orqaga',
  toCatalog: '🛒 Katalog',
  maker: 'Ishlab chiqaruvchi',
  form: 'Shakli',
  ingredient: 'Taʼsir etuvchi modda',
  price: 'Narxi',
  priceOnRequest: 'operator aytadi',
  inStock: '✅ Omborda bor',
  outOfStock: '⏳ Hozir omborda yoʻq — buyurtma qabul qilinadi, muddatini operator aytadi',
  dose: 'Dozasi',
  vetNote: '⚠️ Qoʻllashdan oldin yoʻriqnomani oʻqing va veterinar bilan maslahatlashing.',
  alternative: 'Muqobili',
  howMany: (unit: string) => `Nechta ${unit} kerak?`,
  otherQty: '✍️ Boshqa son',
  askQty: 'Sonini raqam bilan yozing (masalan: 15):',
  badQty: (max: number) => `Iltimos, 1 dan ${max} gacha butun son yozing.`,
  added: (name: string, qty: number) => `✅ Savatga qoʻshildi: <b>${name}</b> × ${qty}`,
  goToCart: '🧺 Savatga oʻtish',
  continueShopping: '🛒 Yana tanlash',
  cartEmpty: 'Savatingiz boʻsh. Katalogdan preparat tanlang 🛒',
  cartTitle: '🧺 <b>Savat</b>',
  cartFull: (n: number) => `Savatga koʻpi bilan ${n} xil preparat sigʻadi.`,
  total: 'Jami',
  totalPartial: 'Narxi maʼlum boʻlganlar jami',
  restByOperator: 'Qolganlarining narxini operator aytadi.',
  allByOperator: 'Narx va yetkazib berishni operator aytadi.',
  checkout: '✅ Buyurtma berish',
  clearCart: '🗑 Tozalash',
  cartCleared: 'Savat tozalandi.',
  itemsDropped: 'Baʼzi preparatlar sotuvdan olingani uchun savatdan chiqarildi.',
  askName: 'Ismingiz yoki xoʻjalik (ferma) nomini yozing:',
  askPhone: 'Telefon raqamingizni yuboring: pastdagi tugmani bosing yoki raqamni yozing (masalan: +998 90 123 45 67).',
  sharePhone: '📱 Raqamni yuborish',
  badPhone: 'Raqam notoʻgʻri koʻrinadi. Masalan: +998 90 123 45 67',
  phoneSaved: (phone: string) => `📱 ${phone}`,
  askRegion: 'Viloyatni tanlang:',
  askAddress: 'Manzilni yozing (tuman, qishloq yoki mahalla, moʻljal):',
  askNote: 'Izoh qoldirasizmi? Masalan: qachon kerak, bosh soni. Kerak boʻlmasa «Oʻtkazib yuborish»ni bosing.',
  skip: '➡️ Oʻtkazib yuborish',
  useSaved: (details: string) => `Oldingi buyurtmadagi maʼlumotlar:\n\n${details}\n\nShulardan foydalanaymi?`,
  yes: '✅ Ha',
  edit: '✏️ Oʻzgartirish',
  confirmTitle: '<b>Buyurtmani tekshiring:</b>',
  fName: 'Ism',
  fPhone: 'Telefon',
  fRegion: 'Viloyat',
  fAddress: 'Manzil',
  fNote: 'Izoh',
  confirm: '✅ Tasdiqlash',
  cancel: '❌ Bekor qilish',
  orderPlaced: (id: number) =>
    `✅ Buyurtmangiz qabul qilindi! Raqami: <b>#${id}</b>\n\n` +
    'Operator narx, yetkazib berish va toʻlovni kelishish uchun tez orada siz bilan bogʻlanadi.',
  checkoutCancelled: 'Buyurtma bekor qilindi. Savat saqlanib qoldi.',
  staleButton: 'Bu tugma eskirgan. Menyudan qaytadan boshlang.',
  ordersEmpty: 'Sizda hali buyurtma yoʻq.',
  ordersTitle: '📦 <b>Soʻnggi buyurtmalaringiz</b>',
  statusChanged: (id: number, status: string) => `Buyurtma <b>#${id}</b>: ${status}`,
  payPrompt: (amount: string | null) =>
    amount ? `Toʻlov summasi: <b>${amount}</b>. Toʻlov usulini tanlang:` : 'Toʻlov usulini tanlang:',
  receiptHint: 'Toʻlovdan keyin chek rasmini shu chatga yuboring.',
  contactTitle: '📞 <b>Aloqa</b>',
  phone: 'Telefon',
  contactFallback: 'Savolingizni shu yerga yozing — operator javob beradi.',
  questionForwarded: 'Xabaringiz operatorga yuborildi. Tez orada javob beramiz.',
  receiptForwarded: (id: number) => `Rasm operatorga yuborildi (buyurtma #${id}). Rahmat!`,
  tooManyMessages: 'Bugun juda koʻp xabar yuborildi. Iltimos, operatorga telefon qiling.',
  operatorSays: '💬 <b>Operator:</b>',
  productMissing: 'Bu preparat topilmadi yoki hozir sotuvda yoʻq.',
  tooLong: (n: number) => `Matn juda uzun (koʻpi bilan ${n} belgi).`,
  needText: 'Iltimos, javobni matn bilan yozing.',
  error: 'Xatolik yuz berdi. Iltimos, birozdan keyin qayta urinib koʻring.',
  sum: (n: string) => `${n} soʻm`,
};

const ru: typeof uz = {
  chooseLang: 'Tilni tanlang / Выберите язык:',
  langSaved: 'Язык: русский ✅',
  welcome:
    'Здравствуйте! <b>VETCO</b> — ветеринарные препараты для животноводства.\n\n' +
    'Здесь можно посмотреть каталог и оформить заказ. Пользуйтесь меню ниже 👇',
  catalogTitle: 'Выберите раздел:',
  catalogEmpty: 'Каталог пока пуст. Попробуйте позже или напишите оператору.',
  categoryTitle: (name: string) => `<b>${name}</b>\nВыберите препарат:`,
  back: '⬅️ Назад',
  toCatalog: '🛒 Каталог',
  maker: 'Производитель',
  form: 'Форма',
  ingredient: 'Действующее вещество',
  price: 'Цена',
  priceOnRequest: 'уточнит оператор',
  inStock: '✅ В наличии',
  outOfStock: '⏳ Сейчас нет на складе — заказ принимаем, срок уточнит оператор',
  dose: 'Дозировка',
  vetNote: '⚠️ Перед применением прочитайте инструкцию и проконсультируйтесь с ветеринаром.',
  alternative: 'Аналог',
  howMany: (unit: string) => `Укажите количество (ед.: ${unit}):`,
  otherQty: '✍️ Другое количество',
  askQty: 'Введите количество цифрой (например: 15):',
  badQty: (max: number) => `Пожалуйста, введите целое число от 1 до ${max}.`,
  added: (name: string, qty: number) => `✅ Добавлено в корзину: <b>${name}</b> × ${qty}`,
  goToCart: '🧺 Перейти в корзину',
  continueShopping: '🛒 Выбрать ещё',
  cartEmpty: 'Корзина пуста. Выберите препарат в каталоге 🛒',
  cartTitle: '🧺 <b>Корзина</b>',
  cartFull: (n: number) => `В корзине может быть не больше ${n} разных препаратов.`,
  total: 'Итого',
  totalPartial: 'Итого по известным ценам',
  restByOperator: 'Цену остальных уточнит оператор.',
  allByOperator: 'Цену и доставку уточнит оператор.',
  checkout: '✅ Оформить заказ',
  clearCart: '🗑 Очистить',
  cartCleared: 'Корзина очищена.',
  itemsDropped: 'Некоторые препараты сняты с продажи и удалены из корзины.',
  askName: 'Напишите ваше имя или название хозяйства (фермы):',
  askPhone: 'Отправьте номер телефона: нажмите кнопку ниже или напишите номер (например: +998 90 123 45 67).',
  sharePhone: '📱 Отправить номер',
  badPhone: 'Номер выглядит неверно. Пример: +998 90 123 45 67',
  phoneSaved: (phone: string) => `📱 ${phone}`,
  askRegion: 'Выберите область:',
  askAddress: 'Напишите адрес (район, село или махалля, ориентир):',
  askNote: 'Хотите оставить комментарий? Например: когда нужно, поголовье. Если нет — нажмите «Пропустить».',
  skip: '➡️ Пропустить',
  useSaved: (details: string) => `Данные из прошлого заказа:\n\n${details}\n\nИспользовать их?`,
  yes: '✅ Да',
  edit: '✏️ Изменить',
  confirmTitle: '<b>Проверьте заказ:</b>',
  fName: 'Имя',
  fPhone: 'Телефон',
  fRegion: 'Область',
  fAddress: 'Адрес',
  fNote: 'Комментарий',
  confirm: '✅ Подтвердить',
  cancel: '❌ Отменить',
  orderPlaced: (id: number) =>
    `✅ Заказ принят! Номер: <b>#${id}</b>\n\n` +
    'Оператор скоро свяжется с вами, чтобы согласовать цену, доставку и оплату.',
  checkoutCancelled: 'Оформление отменено. Корзина сохранена.',
  staleButton: 'Эта кнопка устарела. Начните заново из меню.',
  ordersEmpty: 'У вас пока нет заказов.',
  ordersTitle: '📦 <b>Ваши последние заказы</b>',
  statusChanged: (id: number, status: string) => `Заказ <b>#${id}</b>: ${status}`,
  payPrompt: (amount: string | null) =>
    amount ? `Сумма к оплате: <b>${amount}</b>. Выберите способ оплаты:` : 'Выберите способ оплаты:',
  receiptHint: 'После оплаты отправьте фото чека в этот чат.',
  contactTitle: '📞 <b>Контакты</b>',
  phone: 'Телефон',
  contactFallback: 'Напишите вопрос сюда — оператор ответит.',
  questionForwarded: 'Сообщение передано оператору. Скоро ответим.',
  receiptForwarded: (id: number) => `Фото передано оператору (заказ #${id}). Спасибо!`,
  tooManyMessages: 'Сегодня отправлено слишком много сообщений. Пожалуйста, позвоните оператору.',
  operatorSays: '💬 <b>Оператор:</b>',
  productMissing: 'Препарат не найден или сейчас не продаётся.',
  tooLong: (n: number) => `Текст слишком длинный (максимум ${n} символов).`,
  needText: 'Пожалуйста, ответьте текстом.',
  error: 'Произошла ошибка. Пожалуйста, попробуйте чуть позже.',
  sum: (n: string) => `${n} сум`,
};

export const T: Record<Lang, typeof uz> = { uz, ru };

/** Texts for the operators' chat (Uzbek only). */
export const A = {
  newOrder: (id: number) => `🆕 <b>Yangi buyurtma #${id}</b>`,
  customer: 'Mijoz',
  lang: 'Til',
  items: 'Preparatlar',
  status: 'Holat',
  by: 'kim',
  setConfirmed: '✅ Tasdiqlash',
  setShipped: '🚚 Yuborildi',
  setDelivered: '📬 Yetkazildi',
  setCancelled: '❌ Bekor',
  replyHint: '↩️ Mijozga javob berish uchun shu xabarga reply qiling.',
  question: (who: string) => `💬 <b>Mijoz xabari</b> — ${who}`,
  receipt: (id: number, who: string) => `🧾 <b>Rasm/chek</b> — buyurtma #${id}, ${who}`,
  notAdmin: 'Bu amal faqat operatorlar uchun.',
  saved: 'Saqlandi',
  badTransition: 'Bu holatga oʻtkazib boʻlmaydi',
  orderMissing: 'Buyurtma topilmadi',
  replySent: '✅ Mijozga yuborildi.',
  replyFailed: (why: string) => `⚠️ Yuborilmadi: ${why}`,
  syncNoUrl: 'CATALOG_CSV_URL sozlanmagan.',
  syncOk: (active: number, total: number) => `✅ Katalog yangilandi: ${total} qator, ${active} ta faol preparat.`,
  syncErrors: (n: number) => `⚠️ ${n} ta qator oʻtkazib yuborildi:`,
  syncFailed: (why: string) => `❌ Katalog yangilanmadi: ${why}`,
  photoUsage: 'Rasm yuboring va izohiga <code>/photo mahsulot_id</code> deb yozing (masalan <code>/photo bistrepen</code>).',
  photoSaved: (name: string) => `✅ Rasm saqlandi: ${name}`,
  photoNoProduct: (id: string) => `Bunday mahsulot yoʻq: ${id}`,
  ordersNone: 'Ochiq buyurtma yoʻq.',
  ordersOpen: '<b>Ochiq buyurtmalar</b>',
  stats: (today: number, week: number, month: number, sum: string) =>
    `📊 <b>Buyurtmalar</b>\nBugun: ${today}\n7 kun: ${week}\n30 kun: ${month}\n30 kunlik summa (narxi maʼlumlar): ${sum} soʻm`,
  help:
    '<b>Operator buyruqlari</b>\n' +
    '/orders — ochiq buyurtmalar\n' +
    '/stats — statistika\n' +
    '/sync — katalogni Google Sheets dan yangilash\n' +
    '/photo id — rasm izohida: mahsulot rasmini saqlash\n' +
    '/id — chat va foydalanuvchi ID',
};
