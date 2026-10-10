import test from 'node:test';
import assert from 'node:assert/strict';
import { openDatabase, migrate, schemaVersion } from '../server/db.js';
import { MIGRATIONS } from '../shared/migrations.js';

test('migrations apply once and are idempotent', async () => {
  const db = await openDatabase();
  assert.equal(migrate(db), MIGRATIONS.length);
  assert.equal(migrate(db), 0);
  assert.equal(schemaVersion(db), MIGRATIONS.at(-1).version);
  const tables = db.exec("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")[0].values.flat();
  for (const t of ['accounts', 'budgets', 'card_charges', 'categories', 'category_rules', 'connections', 'recurring_items', 'settings', 'transactions']) {
    assert.ok(tables.includes(t), `missing table ${t}`);
  }
});

test('a failing migration rolls back and reports its version', async () => {
  const db = await openDatabase();
  migrate(db);
  const bad = [...MIGRATIONS, { version: 999, name: 'bad', sql: 'CREATE TABLE ok_table (x); THIS IS NOT SQL;' }];
  assert.throws(() => migrate(db, bad), /migration 999/);
  assert.equal(schemaVersion(db), MIGRATIONS.at(-1).version);
  assert.equal(db.exec("SELECT name FROM sqlite_master WHERE name='ok_table'").length, 0);
});

test('schema enforces allowed values', async () => {
  const db = await openDatabase();
  migrate(db);
  assert.throws(() => db.run("INSERT INTO connections (id, kind, provider, display_name) VALUES ('c', 'crypto', 'x', 'y')"));
  db.run("INSERT INTO connections (id, kind, provider, display_name) VALUES ('c', 'bank', 'leumi', 'לאומי')");
  assert.throws(() => db.run("UPDATE connections SET status = 'whatever' WHERE id = 'c'"));
});
