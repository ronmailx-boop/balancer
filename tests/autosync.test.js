import test from 'node:test';
import assert from 'node:assert/strict';
import { openDatabase, migrate } from '../server/db.js';
import { slotKey, takeAutoSyncSlot } from '../server/autosync.js';

// Israel is UTC+3 in October (summer time)
const il = (date, hh) => Date.parse(`${date}T${String(hh).padStart(2, '0')}:30:00+03:00`);

test('slots: 07:00 morning, 19:00 evening, after midnight still last evening', () => {
  assert.equal(slotKey(il('2026-10-10', 6)), '2026-10-09 evening');
  assert.equal(slotKey(il('2026-10-10', 7)), '2026-10-10 morning');
  assert.equal(slotKey(il('2026-10-10', 18)), '2026-10-10 morning');
  assert.equal(slotKey(il('2026-10-10', 19)), '2026-10-10 evening');
  assert.equal(slotKey(il('2026-10-10', 23)), '2026-10-10 evening');
});

test('each slot syncs once, skips connections already synced in it, and can be turned off', async () => {
  const db = await openDatabase();
  migrate(db);
  db.run("INSERT INTO connections (id, kind, provider, display_name, last_sync_at) VALUES ('a', 'bank', 'leumi', 'לאומי', ?), ('b', 'card', 'max', 'מקס', NULL), ('c', 'card', 'visaCal', 'כאל', NULL)",
    [new Date(il('2026-10-10', 8)).toISOString()]);
  db.run("UPDATE connections SET status = 'needs_attention' WHERE id = 'c'");
  assert.deepEqual(takeAutoSyncSlot(db, il('2026-10-10', 9)), ['b'], 'a synced this morning by hand, c needs attention');
  assert.equal(takeAutoSyncSlot(db, il('2026-10-10', 12)), null, 'same slot: nothing');
  assert.deepEqual(takeAutoSyncSlot(db, il('2026-10-10', 20)), ['a', 'b'], 'evening slot');
  db.run("INSERT OR REPLACE INTO settings (key, value) VALUES ('auto_sync', '0')");
  assert.equal(takeAutoSyncSlot(db, il('2026-10-11', 8)), null, 'off');
});
