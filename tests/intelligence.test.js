import test from 'node:test';
import assert from 'node:assert/strict';
import { openDatabase, migrate } from '../server/db.js';
import { generateDemo } from '../shared/demo.js';
import { detectSeries, detectRecurring, merchantKey } from '../shared/recurring.js';
import * as Q from '../server/queries.js';

const TODAY = '2026-10-10';

async function demoDb() {
  const db = await openDatabase();
  migrate(db);
  generateDemo(db, { today: new Date(2026, 9, 10) });
  return db;
}
const series = (dates, amounts) => dates.map((date, i) => ({ date, amount: Array.isArray(amounts) ? amounts[i] : amounts }));

test('merchant key ignores reference numbers', () => {
  assert.equal(merchantKey('הוראת קבע 123456 - חברת חשמל'), merchantKey('הוראת קבע 998877 - חברת חשמל'));
});

test('detects monthly, bimonthly and stopped series; ignores shopping', () => {
  const netflix = detectSeries(series(['2026-06-05', '2026-07-05', '2026-08-05', '2026-09-05'], -54.9), TODAY);
  assert.equal(netflix.cadence, 'monthly');
  assert.equal(netflix.nextExpected, '2026-10-05');
  assert.equal(netflix.active, true);

  const electricity = detectSeries(series(['2026-03-20', '2026-05-21', '2026-07-19', '2026-09-20'], [-320, -450, -510, -390]), TODAY);
  assert.equal(electricity.cadence, 'bimonthly');

  // Random days and amounts: a shop, not a standing order
  assert.equal(detectSeries(series(['2026-06-03', '2026-07-21', '2026-08-09', '2026-09-27'], [-120, -310, -95, -260]), TODAY), null);
  // Only two charges are not enough for monthly
  assert.equal(detectSeries(series(['2026-08-05', '2026-09-05'], -30), TODAY), null);

  const stopped = detectSeries(series(['2026-03-01', '2026-04-01', '2026-05-01', '2026-06-01'], -100), TODAY);
  assert.equal(stopped.active, false);
});

test('recurring detection on demo data, and dismissing an item', async () => {
  const db = await demoDb();
  const names = Q.all(db, "SELECT merchant FROM recurring_items WHERE status = 'active'").map(r => r.merchant);
  for (const expected of ['הוראת קבע - שכר דירה', 'NETFLIX.COM', 'משכורת - טכנולוגיות בע"מ', 'חברת החשמל']) assert.ok(names.includes(expected), expected);
  assert.ok(!names.includes('ACE') && !names.includes('זארה'), 'shops are not recurring');

  const netflix = Q.one(db, "SELECT id FROM recurring_items WHERE merchant = 'NETFLIX.COM'");
  assert.ok(Q.one(db, "SELECT COUNT(*) AS n FROM transactions WHERE description = 'NETFLIX.COM' AND is_recurring = 1").n > 0);
  Q.dismissRecurring(db, netflix.id, true, TODAY);
  assert.equal(Q.one(db, 'SELECT status FROM recurring_items WHERE id = ?', [netflix.id]).status, 'paused');
  assert.equal(Q.one(db, "SELECT COUNT(*) AS n FROM transactions WHERE description = 'NETFLIX.COM' AND is_recurring = 1").n, 0);
  detectRecurring(db, TODAY); // survives a rebuild
  assert.equal(Q.one(db, 'SELECT status FROM recurring_items WHERE id = ?', [netflix.id]).status, 'paused');
  Q.dismissRecurring(db, netflix.id, false, TODAY);
  assert.equal(Q.one(db, 'SELECT status FROM recurring_items WHERE id = ?', [netflix.id]).status, 'active');
});

test('alerts: price rise and possible double charge', async () => {
  const db = await demoDb();
  const last = Q.one(db, "SELECT id, date FROM transactions WHERE description = 'NETFLIX.COM' ORDER BY date DESC");
  db.run('UPDATE transactions SET charged_amount = -64.9, original_amount = -64.9, date = ? WHERE id = ?', ['2026-10-05', last.id]);
  const card = Q.one(db, "SELECT id FROM accounts WHERE type = 'card'");
  db.run(`INSERT INTO transactions (id, account_id, date, description, original_amount, charged_amount, type, source_hash)
    VALUES ('d1', ?, '2026-10-04', 'שופרסל דיל', -312.5, -312.5, 'normal', 'שופרסל דיל'), ('d2', ?, '2026-10-04', 'שופרסל דיל', -312.5, -312.5, 'normal', 'שופרסל דיל')`, [card.id, card.id]);
  detectRecurring(db, TODAY);
  const kinds = Q.overview(db, { month: '2026-10', today: TODAY }).alerts.map(a => a.kind);
  assert.ok(kinds.includes('price_up'), 'price rise');
  assert.ok(kinds.includes('duplicate'), 'double charge');
});

test('split transaction is counted by its parts', async () => {
  const db = await demoDb();
  const card = Q.one(db, "SELECT id FROM accounts WHERE type = 'card'");
  const before = Object.fromEntries(Q.categoryBreakdown(db, '2026-10').map(c => [c.id, c.amount]));
  db.run(`INSERT INTO transactions (id, account_id, date, description, original_amount, charged_amount, type, category_id)
    VALUES ('sp', ?, '2026-10-02', 'שופרסל', -500, -500, 'normal', 'groceries')`, [card.id]);
  const res = Q.setSplits(db, 'sp', [{ categoryId: 'gifts', amount: 150 }]);
  assert.equal(res.split, true);
  assert.deepEqual(res.splits.map(p => [p.categoryId, p.amount]), [['gifts', -150], ['groceries', -350]]);
  const after = Object.fromEntries(Q.categoryBreakdown(db, '2026-10').map(c => [c.id, c.amount]));
  assert.equal(Math.round((after.groceries - (before.groceries || 0)) * 100) / 100, 350);
  assert.equal(Math.round((after.gifts - (before.gifts || 0)) * 100) / 100, 150);
  assert.ok(Q.transactions(db, { month: '2026-10', category: 'gifts' }).some(t => t.id === 'sp'));
  assert.throws(() => Q.setSplits(db, 'sp', [{ categoryId: 'gifts', amount: 600 }]));
  Q.setSplits(db, 'sp', []);
  assert.equal(Q.transactionById(db, 'sp').split, false);
});

test('categories and rules: add, rename, protect built-ins, delete', async () => {
  const db = await demoDb();
  const id = Q.saveCategory(db, { name: 'חיות מחמד', icon: '🐶', type: 'expense' });
  assert.ok(id.startsWith('u-'));
  assert.throws(() => Q.saveCategory(db, { name: 'חיות מחמד', icon: '🐱', type: 'expense' }), e => e.code === 'name_taken');
  Q.saveCategory(db, { id: 'card_payment', name: 'חיוב כרטיס', icon: '💳', type: 'expense' });
  assert.equal(Q.one(db, "SELECT type FROM categories WHERE id = 'card_payment'").type, 'transfer', 'built-in type is kept');
  assert.throws(() => Q.deleteCategory(db, 'groceries'), e => e.code === 'not_found');

  const card = Q.one(db, "SELECT id FROM accounts WHERE type = 'card'");
  db.run(`INSERT INTO transactions (id, account_id, date, description, original_amount, charged_amount, type, category_id)
    VALUES ('pet', ?, '2026-10-03', 'זוטופיה חנות חיות', -90, -90, 'normal', NULL)`, [card.id]);
  assert.equal(Q.addRule(db, { pattern: 'זוטופיה', matchType: 'contains', categoryId: id }), 1);
  assert.equal(Q.transactionById(db, 'pet').categoryId, id);
  const rule = Q.manageCategories(db).rules.find(r => r.categoryId === id);
  Q.deleteRule(db, rule.id);
  assert.equal(Q.transactionById(db, 'pet').categoryId, null);

  Q.addRule(db, { pattern: 'זוטופיה', matchType: 'contains', categoryId: id });
  Q.deleteCategory(db, id);
  assert.equal(Q.transactionById(db, 'pet').categoryId, null);
  assert.equal(Q.manageCategories(db).rules.length, 0, 'its rules are gone');
});

test('insights are short and well formed', async () => {
  const db = await demoDb();
  for (const month of ['2026-10', '2026-09']) {
    const list = Q.insights(db, { month, today: TODAY });
    assert.ok(Array.isArray(list) && list.length <= 4);
    for (const i of list) assert.ok(i.text && i.icon && i.level);
  }
});

test('month flow explains income, expenses and what is not counted', async () => {
  const db = await demoDb();
  const f = Q.monthFlow(db, '2026-09');
  const t = Q.monthTotals(db, '2026-09');
  assert.equal(f.income.total, t.income);
  assert.equal(f.expense.total, t.expenses);
  assert.equal(Math.round(f.expense.categories.reduce((s, c) => s + c.amount, 0) * 100) / 100, t.expenses);
  assert.ok(f.expense.items.every(i => i.amount > 0 && i.categoryType === 'expense'));
  assert.ok(f.notCounted.transfers.count > 0, 'card bills are listed as not counted');
});
