import test from 'node:test';
import assert from 'node:assert/strict';
import { openDatabase, migrate } from '../server/db.js';
import { seedCategories } from '../shared/categories.js';
import { detectFixedPayments, fixedPayments, setFixedPayment, splitBill } from '../server/rolling.js';
import * as Q from '../server/queries.js';

async function setup({ secondCal = false } = {}) {
  const db = await openDatabase();
  migrate(db);
  seedCategories(db);
  db.run(`INSERT INTO connections (id, kind, provider, display_name) VALUES ('cb', 'bank', 'leumi', 'לאומי'), ('cc', 'card', 'visaCal', 'כאל')`);
  db.run(`INSERT INTO accounts (id, connection_id, display_name, masked_number, type, balance) VALUES
    ('bank', 'cb', 'עו"ש', '7599', 'checking', 1000), ('cal1', 'cc', 'כאל 9531', '9531', 'card', -6793)`);
  if (secondCal) db.run(`INSERT INTO accounts (id, connection_id, display_name, masked_number, type, balance) VALUES ('cal2', 'cc', 'כאל 6353', '6353', 'card', -300)`);
  let n = 0;
  const tx = (account, date, processed, description, amount, category = null) => db.run(
    `INSERT INTO transactions (id, account_id, date, processed_date, description, original_amount, charged_amount, type, category_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'normal', ?)`, [`x${++n}`, account, date, processed, description, amount, amount, category]);
  for (const m of ['08', '09', '10']) {
    tx('bank', `2026-${m}-10`, null, 'כאל חיוב כרטיס', -2000, 'card_payment'); // fixed payment
    tx('cal1', `2026-${m === '08' ? '07' : String(Number(m) - 1).padStart(2, '0')}-20`, `2026-${m}-10`, 'שופרסל', -5000);
  }
  db.run("INSERT INTO card_charges (account_id, charge_date, amount) VALUES ('cal1', '2026-11-10', 6793)");
  return db;
}

test('fixed payment is split from the bill', () => {
  assert.deepEqual(splitBill(6793, 2000), { debit: 2000, rolled: 4793 });
  assert.deepEqual(splitBill(1500, 2000), { debit: 1500, rolled: 0 });
  assert.deepEqual(splitBill(6793, 0), { debit: 6793, rolled: 0 });
});

test('rolling credit is detected from the bank debits and used for upcoming charges', async () => {
  const db = await setup();
  assert.deepEqual(detectFixedPayments(db, '2026-10-12'), { cal1: 2000 });
  const [c] = Q.upcomingCharges(db, '2026-10-12');
  assert.equal(c.amount, 2000, 'what leaves the bank');
  assert.equal(c.total, 6793);
  assert.equal(c.rolled, 4793);
  assert.equal(Q.projection(db, '2026-10-12').items.find(i => i.label === 'חיוב כרטיס אשראי')?.amount ?? -2000, -2000);
  const card = Q.accountsOverview(db).accounts.find(a => a.id === 'cal1');
  assert.equal(card.nextDebit, 2000);
});

test('the user value wins; 0 means no rolling credit; null goes back to detection', async () => {
  const db = await setup();
  detectFixedPayments(db, '2026-10-12');
  setFixedPayment(db, 'cal1', 2500);
  detectFixedPayments(db, '2026-10-12');
  assert.equal(fixedPayments(db).cal1.amount, 2500);
  setFixedPayment(db, 'cal1', 0);
  assert.equal(Q.upcomingCharges(db, '2026-10-12')[0].amount, 6793);
  setFixedPayment(db, 'cal1', null);
  detectFixedPayments(db, '2026-10-12');
  assert.equal(fixedPayments(db).cal1.source, 'auto');
});

test('two cards of the same company: a debit must name the card digits', async () => {
  const db = await setup({ secondCal: true });
  assert.deepEqual(detectFixedPayments(db, '2026-10-12'), {});
  db.run("UPDATE transactions SET description = 'כאל 9531 חיוב' WHERE account_id = 'bank'");
  assert.deepEqual(detectFixedPayments(db, '2026-10-12'), { cal1: 2000 });
});
