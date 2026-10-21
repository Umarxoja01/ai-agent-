// Qurilgan botni (dist/main.js) soxta Telegram serveriga ulab, boshidan oxirigacha
// tekshiradi: /start -> ferma nomi -> "yem 900 ming" -> ✅ -> /hisobot, keyin
// SIGTERM bilan to'xtash va qayta ishga tushganda eski xabarlar qayta ishlanmasligi.
//   npm run build && node scripts/smoke.mjs
//   Docker obrazi bilan: SMOKE_DOCKER_IMAGE=fermer-bot node scripts/smoke.mjs
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const TOKEN = '123456789:AAEsmokesmokesmokesmokesmoke_test';
const USER = 555;
const dir = mkdtempSync(join(tmpdir(), 'fermer-smoke-'));
const queue = [];
const sent = [];
const edits = [];
const offsets = [];
let nextUpdate = 1;
let nextMessage = 1000;

const enqueueText = text => queue.push({ update_id: nextUpdate++, message: { message_id: nextMessage++, from: { id: USER, first_name: 'Sinov' }, chat: { id: USER, type: 'private' }, date: 0, text } });
const enqueuePress = (messageId, data) => queue.push({ update_id: nextUpdate++, callback_query: { id: `q${nextUpdate}`, from: { id: USER }, data, message: { message_id: messageId, chat: { id: USER, type: 'private' }, date: 0, text: '' } } });

const server = createServer((req, res) => {
  let raw = '';
  req.on('data', c => { raw += c; });
  req.on('end', () => {
    const [, token, method] = /^\/bot([^/]+)\/(\w+)$/.exec(req.url ?? '') ?? [];
    const body = raw ? JSON.parse(raw) : {};
    const reply = result => { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ ok: true, result })); };
    if (token !== TOKEN) { res.statusCode = 401; res.end(JSON.stringify({ ok: false, error_code: 401, description: 'Unauthorized' })); return; }
    if (method === 'getMe') return reply({ id: 1, is_bot: true, first_name: 'Fermer', username: 'fermer_smoke_bot' });
    if (method === 'setMyCommands' || method === 'answerCallbackQuery') return reply(true);
    if (method === 'sendMessage') { const id = nextMessage++; sent.push({ id, ...body }); return reply({ message_id: id }); }
    if (method === 'editMessageText') { edits.push(body); return reply(true); }
    if (method === 'getUpdates') {
      offsets.push(body.offset);
      const ready = queue.filter(u => u.update_id >= body.offset);
      setTimeout(() => reply(ready), ready.length ? 0 : 150);
      return;
    }
    res.statusCode = 404; res.end(JSON.stringify({ ok: false, error_code: 404, description: `no ${method}` }));
  });
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}`;

const image = process.env.SMOKE_DOCKER_IMAGE;
const volume = `fermer-smoke-${process.pid}`;

function startBot() {
  const env = { BOT_TOKEN: TOKEN, TELEGRAM_API_URL: base, ADMIN_IDS: String(USER) };
  const child = image
    ? spawn('docker', ['run', '--rm', '--network', 'host', '-v', `${volume}:/data`, ...Object.entries(env).flatMap(([k, v]) => ['-e', `${k}=${v}`]), image], { stdio: ['ignore', 'pipe', 'pipe'] })
    : spawn(process.execPath, ['--no-warnings', 'dist/main.js'], { env: { ...process.env, ...env, DB_PATH: join(dir, 'fermer.db') }, stdio: ['ignore', 'pipe', 'pipe'] });
  let out = '';
  child.stdout.on('data', c => { out += c; });
  child.stderr.on('data', c => { out += c; });
  return { child, output: () => out, exited: new Promise(resolve => child.on('exit', code => resolve(code))) };
}
const waitFor = async (check, what, ms = 5000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) { const v = check(); if (v) return v; await new Promise(r => setTimeout(r, 50)); }
  throw new Error(`kutildi, kelmadi: ${what}`);
};
const assert = (ok, what) => { if (!ok) throw new Error(`XATO: ${what}`); console.log(`ok - ${what}`); };

let bot;
try {
  bot = startBot();
  enqueueText('/start');
  enqueueText('Sinov fermasi');
  enqueueText("Yemga 900 ming so'm to'ladim");
  const card = await waitFor(() => sent.find(m => m.text?.startsWith('Tekshiring')), 'tasdiq kartasi');
  assert(card.text.includes("900 000 so'm"), "karta: 900 000 so'm");
  enqueuePress(card.id, 'ok');
  await waitFor(() => edits.find(e => e.text?.startsWith('✅ Saqlandi')), 'saqlandi');
  assert(true, '✅ bosilganda saqlandi');
  enqueueText('/hisobot');
  const report = await waitFor(() => sent.find(m => m.text?.includes('Sinov fermasi -')), 'hisobot');
  assert(report.text.includes("Xarajat: 900 000 so'm"), 'hisobot xarajatni ko\'rsatdi');
  bot.child.kill('SIGTERM');
  assert(await bot.exited === 0, "SIGTERM bilan toza to'xtadi (exit 0)");

  const before = sent.length;
  bot = startBot();
  await waitFor(() => offsets.length && offsets.at(-1) === nextUpdate, 'qayta ishga tushgandagi offset');
  await new Promise(r => setTimeout(r, 400));
  assert(sent.length === before, "qayta ishga tushganda eski xabarlar qayta ishlanmadi");
  enqueueText('/stats');
  const stats = await waitFor(() => sent.find(m => m.text?.startsWith('Fermerlar:')), 'stats');
  assert(stats.text === 'Fermerlar: 1 (7 kunda faol: 1)\nYozuvlar: 1 (7 kunda: 1)', "baza qayta ishga tushgandan keyin ham saqlangan");
  assert(!bot.output().includes(TOKEN), 'token logga chiqmadi');
  bot.child.kill('SIGTERM');
  await bot.exited;
  console.log('SMOKE OK');
} catch (error) {
  console.error(error.message);
  if (bot) { console.error('--- bot log ---\n' + bot.output()); bot.child.kill('SIGKILL'); }
  process.exitCode = 1;
} finally {
  server.close();
  rmSync(dir, { recursive: true, force: true });
  if (image) spawn('docker', ['volume', 'rm', '-f', volume], { stdio: 'ignore' });
}
