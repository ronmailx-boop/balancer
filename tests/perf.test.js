// Five years of history (~25k transactions) must stay quick. Limits are generous for slow CI;
// the phone is a few times slower than a desktop.
import test from 'node:test';
import assert from 'node:assert/strict';
import { openDatabase, migrate } from '../server/db.js';
import { generateDemo } from '../shared/demo.js';
import { detectRecurring } from '../shared/recurring.js';
import * as Q from '../server/queries.js';

test('large history: main screens stay fast', async () => {
  const db = await openDatabase();
  migrate(db);
  generateDemo(db, { today: new Date(2026, 9, 10) });
  const merchants = ['שופרסל', 'רמי לוי', 'WOLT', 'ארומה', 'פז', 'סונול', 'ZARA', 'KSP', 'סופר פארם', 'IKEA', 'קפה גרג', 'AMAZON'];
  const cats = ['groceries', 'groceries', 'restaurants', 'restaurants', 'transport', 'transport', 'shopping', 'shopping', 'health', 'home', 'restaurants', 'shopping'];
  const accs = Q.all(db, 'SELECT id FROM accounts').map(r => r.id);
  db.run('BEGIN');
  const st = db.prepare("INSERT INTO transactions (id, account_id, date, processed_date, description, original_amount, charged_amount, type, category_id) VALUES (?, ?, ?, ?, ?, ?, ?, 'normal', ?)");
  let n = 0;
  for (let d = 0; d < 365 * 5; d++) {
    const date = new Date(Date.UTC(2021, 9, 10) + d * 86400000).toISOString().slice(0, 10);
    for (let k = 0; k < 14; k++) {
      const m = (d * 7 + k * 3) % merchants.length;
      const amt = -Math.round((20 + ((d * 31 + k * 17) % 400)) * 100) / 100;
      st.run([`perf-${n++}`, accs[k % accs.length], date, date, merchants[m], amt, amt, cats[m]]);
    }
  }
  st.free();
  db.run('COMMIT');

  const time = fn => {
    const t = performance.now();
    fn();
    return performance.now() - t;
  };
  const checks = {
    overview: () => Q.overview(db, { month: '2026-10', today: '2026-10-10' }),
    month: () => Q.monthDetail(db, '2026-09'),
    transactions: () => Q.transactions(db, { month: '2026-09' }),
    search: () => Q.transactions(db, { q: 'ארומה' }),
    trends: () => Q.trends(db, { today: '2026-10-10' }),
    recurring: () => detectRecurring(db, '2026-10-10'),
  };
  for (const [name, fn] of Object.entries(checks)) {
    const ms = time(fn);
    assert.ok(ms < 1500, `${name} took ${Math.round(ms)} ms`);
  }
});
