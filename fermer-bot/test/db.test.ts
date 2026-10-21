import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { Store } from '../src/db.js';

const entry = { kind: 'expense' as const, category: 'feed', date: '2026-10-21', amount: 900_000, qty: null, unit: null, unitPrice: null };
const dirs: string[] = [];
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });

describe('Store', () => {
  it('every read and delete is scoped to the farmer', () => {
    const store = new Store(':memory:');
    store.touchFarmer(1, 1, 'Ali');
    store.touchFarmer(2, 2, 'Vali');
    const a = store.addEntry(1, entry);
    expect(store.entries(2)).toEqual([]);
    expect(store.entry(2, a.id)).toBeUndefined();
    expect(store.deleteEntry(2, a.id)).toBe(false);
    expect(store.entries(1)).toHaveLength(1);
    expect(store.deleteEntry(1, a.id)).toBe(true);
    expect(store.deleteEntry(1, a.id)).toBe(false);
    expect(store.entries(1)).toEqual([]);
    expect(store.lastEntry(1)).toBeUndefined();
  });

  it('deleteFarmer removes the farmer, entries and session for good', () => {
    const store = new Store(':memory:');
    store.touchFarmer(1, 1, 'Ali');
    store.addEntry(1, entry);
    store.addEntry(1, entry);
    store.setSession(1, { step: 'milk' });
    expect(store.deleteFarmer(1)).toBe(2);
    expect(store.farmer(1)).toBeUndefined();
    expect(store.session(1)).toBeUndefined();
    expect(Number((store.db.prepare('SELECT COUNT(*) AS n FROM entries').get() as any).n)).toBe(0);
  });

  it('a file database keeps farmers, entries and the update offset across restarts', () => {
    const dir = mkdtempSync(join(tmpdir(), 'fermer-'));
    dirs.push(dir);
    const path = join(dir, 'sub', 'fermer.db');
    const first = new Store(path);
    first.touchFarmer(7, 7, 'Ali');
    first.setFarmName(7, 'Baraka');
    first.addEntry(7, entry);
    first.setMeta('offset', '42');
    first.close();
    const second = new Store(path);
    expect(second.farmer(7)?.farmName).toBe('Baraka');
    expect(second.entries(7)).toHaveLength(1);
    expect(second.getMeta('offset')).toBe('42');
    second.close();
  });

  it('stats are counts only', () => {
    const store = new Store(':memory:', () => new Date('2026-10-21T00:00:00Z'));
    store.touchFarmer(1, 1, 'Ali');
    store.addEntry(1, entry);
    expect(store.stats('2026-10-14T00:00:00Z')).toEqual({ farmers: 1, activeFarmers: 1, entries: 1, entriesSince: 1 });
  });
});
