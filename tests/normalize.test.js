import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeResult, israelDay, maskAccountNumber, isSameCharge } from '../shared/normalize.js';
import { openDatabase, migrate } from '../server/db.js';
import { seedCategories } from '../shared/categories.js';
import { mergeScrape } from '../server/merge.js';
import * as Q from '../server/queries.js';
import { leumiFirst, maxFirst, maxSecond } from './fixtures/scrapes.js';

const TODAY = '2026-10-10';

async function db() {
  const d = await openDatabase();
  migrate(d);
  seedCategories(d);
  d.run("INSERT INTO connections (id, kind, provider, display_name) VALUES ('c-leumi', 'bank', 'leumi', 'לאומי'), ('c-max', 'card', 'max', 'מקס')");
  return d;
}
const merge = (d, connectionId, kind, result, name = 'x') =>
  mergeScrape(d, { connectionId, displayName: name, normalized: normalizeResult({ connectionId, kind, result, today: TODAY }), startDay: '2026-04-01' });

test('dates are converted to the Israeli calendar day', () => {
  assert.equal(israelDay('2026-10-04T21:00:00.000Z'), '2026-10-05'); // summer time: UTC+3
  assert.equal(israelDay('2026-11-09T22:00:00.000Z'), '2026-11-10'); // winter time: UTC+2
  assert.equal(israelDay('2026-10-05'), '2026-10-05');
  assert.equal(israelDay('garbage'), null);
});

test('account numbers are masked to the last 4 digits', () => {
  assert.equal(maskAccountNumber('123-456789/01'), '8901');
  assert.equal(maskAccountNumber(5532), '5532');
});

test('normalization: types, installments, currency, ids', () => {
  const n = normalizeResult({ connectionId: 'c-max', kind: 'card', result: maxFirst, today: TODAY });
  assert.equal(n.accounts[0].type, 'card');
  const [c1, c2, ikea, ali, pending] = n.transactions;
  assert.notEqual(c1.id, c2.id, 'two identical coffees on the same day stay two transactions');
  assert.equal(ikea.type, 'installments');
  assert.deepEqual([ikea.installment_number, ikea.installment_total], [4, 12]);
  assert.equal(ali.original_currency, 'USD');
  assert.equal(ali.charged_amount, -112.5);
  assert.equal(pending.type, 'pending');
  assert.ok(pending.id.startsWith('p-'));
  // Upcoming bill = everything charged on/after today
  assert.deepEqual(n.cardCharges, [{ account_id: n.accounts[0].id, charge_date: '2026-11-09', amount: 746.5 }]);
  assert.equal(n.accounts[0].balance, -746.5);
});

test('ids are stable across scrapes', () => {
  const a = normalizeResult({ connectionId: 'c-max', kind: 'card', result: maxFirst, today: TODAY });
  const b = normalizeResult({ connectionId: 'c-max', kind: 'card', result: maxFirst, today: TODAY });
  assert.deepEqual(a.transactions.map(t => t.id), b.transactions.map(t => t.id));
});

test('merging the same scrape twice adds nothing', async () => {
  const d = await db();
  const first = merge(d, 'c-max', 'card', maxFirst);
  assert.equal(first.added, 5);
  const again = merge(d, 'c-max', 'card', maxFirst);
  assert.equal(again.added, 0);
  assert.equal(again.updated, 5);
  assert.equal(Q.one(d, 'SELECT COUNT(*) AS n FROM transactions').n, 5);
});

test('pending -> posted keeps the user edits and does not duplicate', async () => {
  const d = await db();
  merge(d, 'c-max', 'card', maxFirst);
  const pending = Q.one(d, "SELECT id FROM transactions WHERE type = 'pending'");
  Q.updateTransaction(d, { id: pending.id, notes: 'ארוחת שישי', categoryId: 'home', tags: ['משפחה'] });

  const stats = merge(d, 'c-max', 'card', maxSecond);
  assert.equal(stats.pendingResolved, 1);
  const shufersal = Q.all(d, "SELECT * FROM transactions WHERE description = 'שופרסל דיל'");
  assert.equal(shufersal.length, 1, 'no duplicate');
  assert.equal(shufersal[0].type, 'normal');
  assert.equal(shufersal[0].charged_amount, -251.3, 'amount updated');
  assert.equal(shufersal[0].notes, 'ארוחת שישי');
  assert.equal(shufersal[0].user_category_override, 'home');
  assert.equal(shufersal[0].tags, '["משפחה"]');
  assert.equal(Q.one(d, "SELECT COUNT(*) AS n FROM transactions WHERE type = 'pending'").n, 1, 'the new pending fuel');
});

test('a pending item that disappears is removed', async () => {
  const d = await db();
  merge(d, 'c-max', 'card', maxFirst);
  const without = { ...maxFirst, accounts: [{ ...maxFirst.accounts[0], txns: maxFirst.accounts[0].txns.slice(0, 4) }] };
  const stats = merge(d, 'c-max', 'card', without);
  assert.equal(stats.pendingRemoved, 1);
  assert.equal(Q.one(d, "SELECT COUNT(*) AS n FROM transactions WHERE type = 'pending'").n, 0);
});

test('new transactions are categorized by the rules; card bills on the bank are transfers', async () => {
  const d = await db();
  merge(d, 'c-leumi', 'bank', leumiFirst, 'לאומי');
  merge(d, 'c-max', 'card', maxFirst, 'מקס');
  const cat = desc => Q.one(d, 'SELECT category_id AS c FROM transactions WHERE description = ?', [desc]).c;
  assert.equal(cat('משכורת - חברה בדויה'), 'salary');
  assert.equal(cat('הוראת קבע שכר דירה'), 'rent');
  assert.equal(cat('כאל חיוב כרטיס'), 'card_payment');
  assert.equal(cat('שופרסל דיל'), 'groceries');
  assert.equal(cat('קפה גרג'), 'restaurants');
  const acc = Q.one(d, "SELECT * FROM accounts WHERE connection_id = 'c-leumi'");
  assert.equal(acc.masked_number, '8901');
  assert.equal(acc.balance, 12345.67);
  // Card bills are not counted twice; the installment counts in its charge month (November)
  const totals = Q.monthTotals(d, '2026-10');
  assert.ok(Math.abs(totals.expenses - (42 + 42 + 112.5 + 250)) < 0.01, `expenses ${totals.expenses}`);
  assert.equal(Q.monthTotals(d, '2026-11').expenses, 300);
});

test('isSameCharge guards', () => {
  const p = { account_id: 'a', source_hash: 'X', charged_amount: -100, date: '2026-10-01' };
  assert.ok(isSameCharge(p, { ...p, charged_amount: -105, date: '2026-10-03' }));
  assert.ok(!isSameCharge(p, { ...p, charged_amount: -150 }));
  assert.ok(!isSameCharge(p, { ...p, date: '2026-10-20' }));
  assert.ok(!isSameCharge(p, { ...p, source_hash: 'Y' }));
});
