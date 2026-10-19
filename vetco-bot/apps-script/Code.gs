/**
 * VETCO bot -> Google Sheets, "Buyurtmalar" varag'i.
 *
 * O'rnatish (README.md, "Buyurtmalar Google Sheets'ga" bo'limi):
 * 1. Jadvalda: Kengaytmalar (Extensions) > Apps Script, shu kodni joylang.
 * 2. Project Settings > Script properties: VETCO_KEY = uzun tasodifiy satr
 *    (xuddi shu qiymat Worker'da: npx wrangler secret put SHEETS_WEBHOOK_KEY).
 * 3. Deploy > New deployment > Web app: Execute as "Me", Who has access "Anyone".
 *    /exec bilan tugaydigan URL -> npx wrangler secret put SHEETS_WEBHOOK_URL.
 *
 * Bot har buyurtmani (va har holat o'zgarishini) yuboradi; qator buyurtma raqami bo'yicha
 * yangilanadi, takror qator paydo bo'lmaydi.
 */
var SHEET = 'Buyurtmalar';
var COLUMNS = [
  ['id', 'Buyurtma #'],
  ['created', 'Sana'],
  ['status', 'Holat'],
  ['customer', 'Mijoz'],
  ['phone', 'Telefon'],
  ['region', 'Viloyat'],
  ['address', 'Manzil'],
  ['note', 'Izoh'],
  ['items', 'Preparatlar'],
  ['total', 'Jami, soʻm'],
  ['lang', 'Til'],
  ['telegram', 'Telegram'],
  ['chat_id', 'Chat ID'],
  ['updated', 'Yangilandi'],
];

function doPost(e) {
  var body;
  try {
    body = JSON.parse(e.postData.contents);
  } catch (err) {
    return reply({ ok: false, error: 'bad json' });
  }
  var key = PropertiesService.getScriptProperties().getProperty('VETCO_KEY');
  if (!key || body.key !== key) return reply({ ok: false, error: 'forbidden' });
  var order = body.order;
  if (!order || !order.id) return reply({ ok: false, error: 'no order' });

  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    upsert(order);
  } finally {
    lock.releaseLock();
  }
  return reply({ ok: true });
}

function upsert(order) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(SHEET) || ss.insertSheet(SHEET);
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(COLUMNS.map(function (c) { return c[1]; }));
    sheet.setFrozenRows(1);
  }
  var row = COLUMNS.map(function (c) { return safe(order[c[0]]); });
  var last = sheet.getLastRow();
  if (last > 1) {
    var ids = sheet.getRange(2, 1, last - 1, 1).getValues();
    for (var i = 0; i < ids.length; i++) {
      if (String(ids[i][0]) === String(order.id)) {
        sheet.getRange(i + 2, 1, 1, row.length).setValues([row]);
        return;
      }
    }
  }
  sheet.appendRow(row);
}

// Customer text must never run as a formula; "+998..." must stay text.
function safe(value) {
  if (value === null || value === undefined) return '';
  if (typeof value === 'number') return value;
  var s = String(value);
  return /^[=+\-@]/.test(s) ? "'" + s : s;
}

function reply(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
