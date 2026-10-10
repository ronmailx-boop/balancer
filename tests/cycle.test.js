import test from 'node:test';
import assert from 'node:assert/strict';
import { openDatabase, migrate } from '../server/db.js';
import { generateDemo } from '../shared/demo.js';
import * as Q from '../server/queries.js';

const TODAY = new Date(2026, 9, 10); // 2026-10-10

async function demoDb() {
  const db = await openDatabase();
  migrate(db);
  generateDemo(db, { today: TODAY });
  return db;
}
const setSetting = (db, key, value) => db.run('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)', [key, value]);

test('budget month runs from the start day to the day before it next month', () => {
  assert.deepEqual(Q.monthBounds('2026-10'), ['2026-10-01', '2026-11-01']);
  assert.deepEqual(Q.monthBounds('2026-10', 10), ['2026-10-10', '2026-11-10']);
  assert.deepEqual(Q.monthBounds('2026-12', 10), ['2026-12-10', '2027-01-10']);
  assert.equal(Q.cycleMonth('2026-10-09', 10), '2026-09');
  assert.equal(Q.cycleMonth('2026-10-10', 10), '2026-10');
  assert.equal(Q.cycleMonth('2026-01-05', 10), '2025-12');
  assert.equal(Q.cycleMonth('2026-01-05', 1), '2026-01');
});

test('cycle start day drives month totals and transaction lists', async () => {
  const db = await demoDb();
  assert.equal(Q.cycleDay(db), 1);
  const calendar = Q.monthTotals(db, '2026-09');
  setSetting(db, 'cycle_start_day', '10');
  assert.equal(Q.cycleDay(db), 10);
  const list = Q.transactions(db, { month: '2026-09' });
  assert.ok(list.length > 0);
  for (const t of list) {
    const eff = t.type === 'installments' && t.processedDate ? t.processedDate : t.date;
    assert.ok(eff >= '2026-09-10' && eff < '2026-10-10', `${eff} inside 10.9–9.10`);
  }
  assert.notDeepEqual(Q.monthTotals(db, '2026-09'), calendar);
  setSetting(db, 'cycle_start_day', '99'); // out of range falls back to the 1st
  assert.equal(Q.cycleDay(db), 1);
});

test('bank balance can be limited to chosen accounts', async () => {
  const db = await demoDb();
  db.run("INSERT INTO accounts (id, connection_id, display_name, masked_number, type, balance, currency, updated_at) SELECT 'acc-savings', connection_id, 'חיסכון', '9999', 'checking', 50000, 'ILS', updated_at FROM accounts WHERE type != 'card' LIMIT 1");
  const [main] = Q.all(db, "SELECT id, balance FROM accounts WHERE type != 'card' AND id != 'acc-savings'");
  const both = Q.accountsOverview(db);
  assert.equal(both.total, Math.round((main.balance + 50000) * 100) / 100);
  assert.equal(both.partial, false);

  setSetting(db, 'balance_accounts', JSON.stringify([main.id]));
  const one = Q.accountsOverview(db);
  assert.equal(one.total, Math.round(main.balance * 100) / 100);
  assert.equal(one.partial, true);
  assert.equal(Q.projection(db, '2026-10-10').today, one.total);

  setSetting(db, 'balance_accounts', JSON.stringify(['gone'])); // unknown ids = all accounts again
  assert.equal(Q.accountsOverview(db).total, both.total);
});

test('card bill breakdown lists the card transactions charged on that date', async () => {
  const db = await demoDb();
  const card = Q.one(db, "SELECT id FROM accounts WHERE type = 'card'");
  db.run("INSERT INTO transactions (id, account_id, date, processed_date, description, original_amount, original_currency, charged_amount, type) VALUES ('x1', ?, '2026-10-01', '2026-11-02', 'קפה', -20, 'ILS', -20, 'normal'), ('x2', ?, '2026-10-03', '2026-11-02', 'ספר', -80, 'ILS', -80, 'normal')", [card.id, card.id]);
  const res = Q.cardCharge(db, card.id, '2026-11-02');
  assert.ok(res.items.some(t => t.id === 'x1') && res.items.some(t => t.id === 'x2'));
  assert.ok(res.items.every(t => (t.processedDate || t.date) === '2026-11-02'));
  const bank = Q.one(db, "SELECT id FROM accounts WHERE type != 'card'");
  assert.equal(Q.cardCharge(db, bank.id, '2026-11-02'), null);
});
