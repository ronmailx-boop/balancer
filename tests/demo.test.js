import test from 'node:test';
import assert from 'node:assert/strict';
import { openDatabase, migrate } from '../server/db.js';
import { generateDemo } from '../shared/demo.js';
import * as Q from '../server/queries.js';

const TODAY = new Date(2026, 9, 10); // 2026-10-10

async function demoDb(today = TODAY) {
  const db = await openDatabase();
  migrate(db);
  generateDemo(db, { today });
  return db;
}

test('demo data is deterministic for a given day', async () => {
  const a = await demoDb();
  const b = await demoDb();
  const dump = db => JSON.stringify(Q.all(db, 'SELECT id, date, description, charged_amount FROM transactions ORDER BY id'));
  assert.equal(dump(a), dump(b));
});

test('demo covers the required scenarios', async () => {
  const db = await demoDb();
  const count = sql => Q.one(db, sql).n;
  assert.equal(count('SELECT COUNT(*) AS n FROM accounts'), 3);
  assert.ok(count("SELECT COUNT(*) AS n FROM transactions WHERE type = 'pending'") > 0, 'pending charges');
  assert.ok(count("SELECT COUNT(*) AS n FROM transactions WHERE type = 'installments'") > 0, 'installments');
  assert.ok(count("SELECT COUNT(*) AS n FROM transactions WHERE original_currency = 'USD'") > 0, 'foreign currency');
  assert.ok(count("SELECT COUNT(DISTINCT substr(date, 1, 7)) AS n FROM transactions") >= 6, 'several months');
  assert.equal(count("SELECT COUNT(*) AS n FROM transactions WHERE date > '2026-10-10'"), 0, 'nothing in the future');
  assert.ok(count('SELECT COUNT(*) AS n FROM recurring_items') >= 6);
  const charges = Q.upcomingCharges(db, '2026-10-10');
  assert.deepEqual(charges.map(c => c.date), ['2026-11-02', '2026-11-10'], 'two cards, different billing dates');
});

test('card bills are transfers and do not double count expenses', async () => {
  const db = await demoDb();
  const totals = Q.monthTotals(db, '2026-09');
  const cards = Q.one(db, `SELECT -SUM(charged_amount) AS s FROM transactions t WHERE account_id != 'demo-leumi'
    AND COALESCE(CASE WHEN type = 'installments' THEN processed_date END, date) LIKE '2026-09%'`).s;
  const bankExpenses = Q.one(db, `SELECT -SUM(t.charged_amount) AS s FROM transactions t JOIN categories c ON c.id = t.category_id
    WHERE account_id = 'demo-leumi' AND c.type = 'expense' AND date LIKE '2026-09%'`).s;
  assert.ok(Math.abs(totals.expenses - (cards + bankExpenses)) < 0.01);
  assert.ok(totals.income > 18000);
});

test('category breakdown sums to the month expenses', async () => {
  const db = await demoDb();
  const detail = Q.monthDetail(db, '2026-09');
  const sum = detail.categories.reduce((s, c) => s + c.amount, 0);
  assert.ok(Math.abs(sum - detail.expenses) < 0.05);
  assert.ok(detail.categories.every((c, i, a) => i === 0 || a[i - 1].amount >= c.amount), 'ranked');
});

test('overview: balances, budget, alerts', async () => {
  const db = await demoDb();
  const o = Q.overview(db, { month: '2026-10', today: '2026-10-10' });
  assert.equal(o.balances.accounts.length, 3);
  assert.ok(o.budget.planned > 0);
  assert.ok(Array.isArray(o.alerts));
  assert.ok(o.hasData);
});

test('recategorize with a user merchant rule applies to all past matches', async () => {
  const db = await demoDb();
  const tx = Q.transactions(db, { q: 'קפה גרג' })[0];
  const res = Q.updateTransaction(db, { id: tx.id, categoryId: 'leisure', applyToMerchant: true });
  assert.ok(res.applied > 1);
  const all = Q.transactions(db, { q: 'קפה גרג' });
  assert.ok(all.every(t => t.categoryId === 'leisure'));
});

test('transaction edits are sanitized', async () => {
  const db = await demoDb();
  const tx = Q.transactions(db, {})[0];
  const res = Q.updateTransaction(db, { id: tx.id, notes: '  hi\u0000‮<script>  ', tags: ['a', 'a', ' b ', '', 'x'.repeat(50)], excluded: true });
  assert.equal(res.transaction.notes, 'hi <script>');
  assert.deepEqual(res.transaction.tags, ['a', 'b', 'x'.repeat(30)]);
  assert.equal(res.transaction.excluded, true);
  assert.throws(() => Q.updateTransaction(db, { id: tx.id, categoryId: 'nope' }));
});

test('budget set, copy and totals', async () => {
  const db = await demoDb();
  Q.setBudget(db, '2026-12', [{ categoryId: 'groceries', amount: 3000 }, { categoryId: 'salary', amount: 5 }, { categoryId: 'leisure', amount: -1 }]);
  let b = Q.budget(db, '2026-12');
  assert.equal(b.items.find(i => i.id === 'groceries').planned, 3000);
  assert.equal(b.items.find(i => i.id === 'leisure').planned, null);
  assert.ok(!b.items.some(i => i.id === 'salary'), 'income categories are not budgeted');
  Q.copyBudget(db, '2027-01');
  b = Q.budget(db, '2027-01');
  assert.equal(b.items.find(i => i.id === 'groceries').planned, 3000);
});

test('trends, projection, recurring and installments', async () => {
  const db = await demoDb();
  const t = Q.trends(db, { months: 6, today: '2026-10-10' });
  assert.equal(t.months.length, 6);
  assert.ok(t.averages.length > 5);
  assert.equal(typeof t.projection.projected, 'number');
  const r = Q.recurringAndInstallments(db, '2026-10-10');
  assert.equal(r.installments.length, 2);
  const ikea = r.installments.find(i => i.description.includes('איקאה'));
  assert.equal(ikea.total, 12);
  assert.equal(ikea.remainingAmount, (12 - ikea.number) * 300);
});

test('CSV export escapes formulas and quotes', async () => {
  const db = await demoDb();
  const tx = Q.transactions(db, {})[0];
  Q.updateTransaction(db, { id: tx.id, notes: '=HYPERLINK("x")' });
  const csv = Q.exportCsv(db);
  assert.ok(csv.startsWith('﻿date,'));
  assert.ok(csv.includes(`"'=HYPERLINK(""x"")"`));
});
