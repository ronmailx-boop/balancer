// Detects recurring charges and income (rent, bills, subscriptions, salary) from the transactions.
// Pure local heuristics: same merchant, regular interval, similar amount.
import crypto from 'node:crypto';
import { normalizeText } from './categorize.js';

const DAY = 86400000;
const toMs = iso => Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10)));
const toIso = ms => new Date(ms).toISOString().slice(0, 10);
const median = list => {
  const s = [...list].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const r2 = n => Math.round(n * 100) / 100;

// Reference numbers and dates change between charges of the same merchant
export const merchantKey = description => normalizeText(description).replace(/[\d/.\-#:]+/g, ' ').replace(/\s+/g, ' ').trim();

// [min, max] days between charges, how long after the expected date it still counts as active,
// and how much the amount may vary (max/min of recent charges)
const CADENCES = [
  { cadence: 'weekly', min: 5, max: 9, grace: 5, minCount: 4, spread: 1.3 },
  { cadence: 'monthly', min: 24, max: 38, grace: 12, minCount: 3, spread: 1.45, sameDay: true },
  { cadence: 'bimonthly', min: 52, max: 70, grace: 20, minCount: 3, spread: 2.2, sameDay: true },
  { cadence: 'yearly', min: 340, max: 390, grace: 40, minCount: 2, spread: 1.5 },
];

function addCadence(iso, cadence) {
  const [y, m, d] = iso.split('-').map(Number);
  if (cadence === 'weekly') return toIso(toMs(iso) + 7 * DAY);
  const months = { monthly: 1, bimonthly: 2, yearly: 12 }[cadence];
  const last = new Date(Date.UTC(y, m - 1 + months + 1, 0)).getUTCDate();
  return toIso(Date.UTC(y, m - 1 + months, Math.min(d, last)));
}

// Median distance (in days) from the typical day of the month, on a 30-day circle (31st ~ 1st)
function dayScatter(days) {
  const ref = days[days.length - 1];
  const offsets = days.map(d => ((d - ref + 45) % 30) - 15);
  const mid = median(offsets);
  return median(offsets.map(o => Math.abs(o - mid)));
}

// The charges before the latest one had the same amount (within 1%)
function stablePrior(sorted) {
  const prior = sorted.slice(-4, -1).map(t => Math.abs(t.amount));
  return prior.length >= 2 && Math.min(...prior) > 0 && Math.max(...prior) / Math.min(...prior) <= 1.01;
}

// One series = one merchant on one account. Returns the detection or null.
export function detectSeries(items, today) {
  if (items.length < 2) return null;
  const sorted = [...items].sort((a, b) => a.date.localeCompare(b.date));
  const gaps = [];
  for (let i = 1; i < sorted.length; i++) gaps.push((toMs(sorted[i].date) - toMs(sorted[i - 1].date)) / DAY);
  const gap = median(gaps);
  const c = CADENCES.find(x => gap >= x.min && gap <= x.max);
  if (!c || sorted.length < c.minCount) return null;
  // Most gaps must fit the cadence (one skipped or doubled month is tolerated)
  const fitting = gaps.filter(g => g >= c.min * 0.85 && g <= c.max * 1.15).length;
  if (fitting / gaps.length < 0.75) return null;
  // Standing orders and subscriptions land on about the same day of the month; shopping does not
  if (c.sameDay && dayScatter(sorted.map(t => Number(t.date.slice(8, 10)))) > 3) return null;
  const recent = sorted.slice(-4).map(t => Math.abs(t.amount));
  if (Math.min(...recent) <= 0 || Math.max(...recent) / Math.min(...recent) > c.spread) return null;
  const last = sorted[sorted.length - 1];
  const next = addCadence(last.date, c.cadence);
  const overdueDays = (toMs(today) - toMs(next)) / DAY;
  return {
    cadence: c.cadence,
    typicalAmount: r2(Math.sign(last.amount) * median(recent)),
    lastDate: last.date,
    lastAmount: r2(last.amount),
    // Only a fixed-price item (subscription, standing order) has a meaningful "previous price"
    previousAmount: stablePrior(sorted) ? r2(sorted[sorted.length - 2].amount) : null,
    nextExpected: next,
    occurrences: sorted.length,
    active: overdueDays <= c.grace,
  };
}

const idFor = (accountId, key) => `rec-${crypto.createHash('sha256').update(`${accountId}\u001f${key}`).digest('hex').slice(0, 16)}`;

// Items the user marked as "not recurring" (settings key recurring_dismissed, a JSON list of ids)
export function dismissedIds(db) {
  const stmt = db.prepare("SELECT value FROM settings WHERE key = 'recurring_dismissed'");
  let ids = [];
  try {
    if (stmt.step()) ids = JSON.parse(stmt.getAsObject().value);
  } catch { /* ignore */ } finally {
    stmt.free();
  }
  return new Set(Array.isArray(ids) ? ids : []);
}

// Rebuilds the auto-detected recurring items and the is_recurring flags. Items the user dismissed
// are kept with status 'paused' and do not drive alerts or the projection. Returns the number of items.
export function detectRecurring(db, today) {
  const since = toIso(toMs(today) - 400 * DAY);
  const stmt = db.prepare(`
    SELECT t.id, t.account_id, t.date, t.description, t.charged_amount AS amount,
           COALESCE(t.user_category_override, t.category_id) AS category_id
    FROM transactions t LEFT JOIN categories c ON c.id = COALESCE(t.user_category_override, t.category_id)
    WHERE t.type = 'normal' AND t.is_excluded = 0 AND t.date >= ?
      AND COALESCE(c.type, 'expense') IN ('expense', 'income')`);
  stmt.bind([since]);
  const groups = new Map();
  while (stmt.step()) {
    const t = stmt.getAsObject();
    const key = merchantKey(t.description);
    if (!key) continue;
    const g = `${t.account_id}\u001f${key}`;
    if (!groups.has(g)) groups.set(g, { accountId: t.account_id, key, items: [] });
    groups.get(g).items.push(t);
  }
  stmt.free();

  const dismissed = dismissedIds(db);

  db.run('BEGIN');
  try {
    db.run("DELETE FROM recurring_items WHERE source = 'auto'");
    db.run('UPDATE transactions SET is_recurring = 0 WHERE is_recurring = 1');
    const ins = db.prepare(`INSERT INTO recurring_items (id, merchant, typical_amount, cadence, next_expected, status, merchant_key,
      account_id, category_id, last_date, last_amount, previous_amount, occurrences, source) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'auto')`);
    const flag = db.prepare('UPDATE transactions SET is_recurring = 1 WHERE id = ?');
    let count = 0;
    for (const g of groups.values()) {
      const found = detectSeries(g.items, today);
      if (!found) continue;
      const id = idFor(g.accountId, g.key);
      const last = g.items.reduce((a, b) => (b.date > a.date ? b : a));
      const isDismissed = dismissed.has(id);
      ins.run([id, last.description, found.typicalAmount, found.cadence, found.nextExpected,
        isDismissed ? 'paused' : found.active ? 'active' : 'ended', g.key, g.accountId, last.category_id,
        found.lastDate, found.lastAmount, found.previousAmount, found.occurrences]);
      if (!isDismissed) for (const t of g.items) flag.run([t.id]);
      count++;
    }
    ins.free();
    flag.free();
    db.run('COMMIT');
    return count;
  } catch (e) {
    db.run('ROLLBACK');
    throw e;
  }
}
