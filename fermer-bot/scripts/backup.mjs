// Ishlab turgan bazadan izchil nusxa (SQLite VACUUM INTO) va oxirgi 14 tasini saqlash.
//   Docker:  docker compose exec fermer-bot node --no-warnings scripts/backup.mjs
//   Oddiy:   node --no-warnings scripts/backup.mjs
import { mkdirSync, readdirSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const dbPath = process.env.DB_PATH || 'data/fermer.db';
const dir = join(dirname(dbPath), 'backups');
const keep = Number(process.env.BACKUP_KEEP || 14);
mkdirSync(dir, { recursive: true });
const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
const target = join(dir, `fermer-${stamp}.db`);
const db = new DatabaseSync(dbPath);
try {
  db.exec(`VACUUM INTO '${target.replace(/'/g, "''")}'`);
} finally {
  db.close();
}
const old = readdirSync(dir).filter(f => /^fermer-.*\.db$/.test(f)).sort().slice(0, -keep);
for (const f of old) rmSync(join(dir, f));
console.log(`Zaxira: ${target}${old.length ? ` (${old.length} ta eskisi o'chirildi)` : ''}`);
