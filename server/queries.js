// Read models for the UI. All money is ILS; expenses are negative in the DB and returned positive here.
import { categorize, sortRules, normalizeText } from '../shared/categorize.js';

// Installments count in the month they are charged; everything else by purchase date
const EFF_DATE = "COALESCE(CASE WHEN t.type = 'installments' THEN t.processed_date END, t.date)";
const EFF_CAT = 'COALESCE(t.user_category_override, t.category_id)';
// Counted = not excluded, and not a transfer/ignore category (card bills, moves between own accounts)
const COUNTED = "t.is_excluded = 0 AND COALESCE(c.type, 'expense') IN ('expense', 'income')";

export function all(db, sql, params = []) {
  const stmt = db.prepare(sql);
  try {
    stmt.bind(params);
    const rows = [];
    while (stmt.step()) rows.push(stmt.getAsObject());
    return rows;
  } finally {
    stmt.free();
  }
}
export const one = (db, sql, params) => all(db, sql, params)[0];

export const isMonth = m => typeof m === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(m);

// A "month" is a budget cycle: from its start day up to the day before the same day next month.
// With cycleDay 10, "2026-10" is 2026-10-10 .. 2026-11-09.
export function monthBounds(month, day = 1) {
  const dd = String(day).padStart(2, '0');
  return [`${month}-${dd}`, `${shiftMonth(month, 1)}-${dd}`];
}

export function shiftMonth(month, delta) {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

// The cycle a day belongs to
export function cycleMonth(dayIso, day = 1) {
  const m = dayIso.slice(0, 7);
  return Number(dayIso.slice(8, 10)) < day ? shiftMonth(m, -1) : m;
}

const setting = (db, key) => one(db, 'SELECT value FROM settings WHERE key = ?', [key])?.value;

export function cycleDay(db) {
  const v = Number(setting(db, 'cycle_start_day'));
  return Number.isInteger(v) && v >= 1 && v <= 28 ? v : 1;
}

const bounds = (db, month) => monthBounds(month, cycleDay(db));

// Bank accounts whose balance makes up "יתרה בעו״ש". None chosen (or none left) = all bank accounts.
export function balanceAccountIds(db) {
  const bank = all(db, "SELECT id FROM accounts WHERE type != 'card' ORDER BY display_name").map(r => r.id);
  let chosen = null;
  try { chosen = JSON.parse(setting(db, 'balance_accounts') || 'null'); } catch { /* ignore */ }
  const picked = Array.isArray(chosen) ? bank.filter(id => chosen.includes(id)) : [];
  return picked.length ? picked : bank;
}

export function prefs(db) {
  const included = new Set(balanceAccountIds(db));
  return {
    cycleDay: cycleDay(db),
    bankAccounts: all(db, "SELECT id, display_name AS name, masked_number AS masked, balance FROM accounts WHERE type != 'card' ORDER BY display_name")
      .map(a => ({ ...a, included: included.has(a.id) })),
  };
}

const r2 = n => Math.round((n || 0) * 100) / 100;

export function monthTotals(db, month) {
  const [from, to] = bounds(db, month);
  const row = one(db, `
    SELECT COALESCE(SUM(CASE WHEN COALESCE(c.type, 'expense') = 'income' THEN t.charged_amount END), 0) AS income,
           COALESCE(-SUM(CASE WHEN COALESCE(c.type, 'expense') = 'expense' THEN t.charged_amount END), 0) AS expenses
    FROM transactions t LEFT JOIN categories c ON c.id = ${EFF_CAT}
    WHERE ${COUNTED} AND ${EFF_DATE} >= ? AND ${EFF_DATE} < ?`, [from, to]);
  return { income: r2(row.income), expenses: r2(row.expenses), net: r2(row.income - row.expenses) };
}

export function monthRange(db) {
  const row = one(db, `SELECT MIN(${EFF_DATE}) AS first, MAX(${EFF_DATE}) AS last FROM transactions t`);
  const day = cycleDay(db);
  return row.first ? { first: cycleMonth(row.first, day), last: cycleMonth(row.last, day) } : null;
}

export function categories(db) {
  return all(db, 'SELECT id, name, icon, color, parent_id AS parentId, type, is_fixed AS fixed FROM categories ORDER BY sort_order, name');
}

export function categoryBreakdown(db, month) {
  const [from, to] = bounds(db, month);
  const rows = all(db, `
    SELECT ${EFF_CAT} AS id, c.name, c.icon, c.is_fixed AS fixed, -SUM(t.charged_amount) AS amount, COUNT(*) AS count
    FROM transactions t LEFT JOIN categories c ON c.id = ${EFF_CAT}
    WHERE ${COUNTED} AND COALESCE(c.type, 'expense') = 'expense' AND ${EFF_DATE} >= ? AND ${EFF_DATE} < ?
    GROUP BY ${EFF_CAT} ORDER BY amount DESC`, [from, to]);
  const budgets = Object.fromEntries(all(db, 'SELECT category_id, planned_amount FROM budgets WHERE month = ?', [month])
    .map(b => [b.category_id, b.planned_amount]));
  const total = rows.reduce((s, r) => s + r.amount, 0);
  return rows.map(r => ({
    id: r.id,
    name: r.id ? r.name : 'ללא קטגוריה',
    icon: r.id ? r.icon : '❔',
    fixed: Boolean(r.fixed),
    amount: r2(r.amount),
    count: r.count,
    pct: total ? Math.round(r.amount / total * 1000) / 10 : 0,
    budget: r.id && budgets[r.id] != null ? budgets[r.id] : null,
  }));
}

export function accountsOverview(db) {
  const accounts = all(db, `
    SELECT a.id, a.display_name AS name, a.masked_number AS masked, a.type, a.balance, a.currency, a.updated_at AS updatedAt,
           c.id AS connectionId, c.provider, c.kind, c.display_name AS connectionName, c.status, c.last_sync_at AS lastSyncAt
    FROM accounts a JOIN connections c ON c.id = a.connection_id ORDER BY c.kind, a.display_name`);
  const included = new Set(balanceAccountIds(db));
  const total = accounts.filter(a => included.has(a.id)).reduce((s, a) => s + (a.balance || 0), 0);
  const bankCount = accounts.filter(a => a.type !== 'card').length;
  return { total: r2(total), accounts: accounts.map(a => ({ ...a, inBalance: included.has(a.id) })), partial: included.size < bankCount };
}

export function upcomingCharges(db, today) {
  return all(db, `
    SELECT cc.account_id AS accountId, a.display_name AS name, a.masked_number AS masked, cc.charge_date AS date, cc.amount AS amount
    FROM card_charges cc JOIN accounts a ON a.id = cc.account_id
    WHERE cc.charge_date >= ? ORDER BY cc.charge_date`, [today]).map(c => ({ ...c, amount: r2(c.amount) }));
}

export function overview(db, { month, today }) {
  const totals = monthTotals(db, month);
  const breakdown = categoryBreakdown(db, month);
  const planned = one(db, 'SELECT COALESCE(SUM(planned_amount), 0) AS p FROM budgets WHERE month = ?', [month]).p;
  const budgetedSpent = breakdown.filter(b => b.budget != null).reduce((s, b) => s + b.amount, 0);
  const balances = accountsOverview(db);
  const charges = upcomingCharges(db, today);
  return {
    month,
    ...totals,
    budget: planned ? { planned: r2(planned), spent: r2(budgetedSpent), remaining: r2(planned - budgetedSpent) } : null,
    balances,
    upcomingCharges: charges,
    topCategories: breakdown.slice(0, 4),
    alerts: alerts(db, { month, today, breakdown, balances, charges }),
    cycle: bounds(db, month),
    hasData: balances.accounts.length > 0,
  };
}

function alerts(db, { month, today, breakdown, balances, charges }) {
  const out = [];
  for (const conn of all(db, "SELECT display_name AS name, status FROM connections WHERE status IN ('needs_attention', 'otp_required', 'error')")) {
    out.push({ level: 'critical', kind: 'connection', text: `החיבור ל${conn.name} דורש טיפול` });
  }
  // Overspending, scaled to how far into the month we are
  const isCurrent = cycleMonth(today, cycleDay(db)) === month;
  for (const b of breakdown) {
    if (b.budget == null || b.budget <= 0) continue;
    if (b.amount > b.budget * 1.005) out.push({ level: 'critical', kind: 'budget', categoryId: b.id, text: `חריגה בתקציב ${b.name}: ${fmt(b.amount)} מתוך ${fmt(b.budget)}` });
    else if (isCurrent && !b.fixed && b.amount > b.budget * 0.9) out.push({ level: 'warning', kind: 'budget', categoryId: b.id, text: `קרוב לגבול בתקציב ${b.name}` });
  }
  // Unusual charge: a single expense above 3x the median expense of its category in the last 6 months
  const [from, to] = bounds(db, month);
  const history = all(db, `
    SELECT ${EFF_CAT} AS cat, -t.charged_amount AS amount FROM transactions t LEFT JOIN categories c ON c.id = ${EFF_CAT}
    WHERE ${COUNTED} AND c.type = 'expense' AND t.charged_amount < 0 AND t.type != 'installments' AND ${EFF_DATE} >= ? AND ${EFF_DATE} < ?`,
  [bounds(db, shiftMonth(month, -6))[0], from]);
  const byCat = {};
  for (const h of history) (byCat[h.cat] ??= []).push(h.amount);
  const current = all(db, `
    SELECT t.id, t.description, -t.charged_amount AS amount, ${EFF_CAT} AS cat FROM transactions t LEFT JOIN categories c ON c.id = ${EFF_CAT}
    WHERE ${COUNTED} AND c.type = 'expense' AND t.charged_amount < 0 AND t.type != 'installments' AND c.is_fixed = 0
      AND ${EFF_DATE} >= ? AND ${EFF_DATE} < ?`, [from, to]);
  for (const t of current) {
    const list = byCat[t.cat];
    if (!list || list.length < 4) continue;
    const median = [...list].sort((a, b) => a - b)[Math.floor(list.length / 2)];
    if (t.amount > Math.max(median * 3, 150)) out.push({ level: 'warning', kind: 'unusual', transactionId: t.id, text: `חיוב חריג: ${t.description} ${fmt(t.amount)}` });
  }
  // Card bills larger than the bank balance
  // Card bills still due in the current cycle, against the chosen bank balance
  const [, cycleEnd] = bounds(db, cycleMonth(today, cycleDay(db)));
  const due = charges.filter(c => c.date < cycleEnd).reduce((s, c) => s + c.amount, 0);
  if (due > 0 && balances.total < due) out.push({ level: 'critical', kind: 'balance', text: 'היתרה בעו"ש נמוכה מחיובי האשראי הקרובים' });
  return out.slice(0, 6);
}

const fmt = n => `₪${Math.round(n).toLocaleString('he-IL')}`;

export function monthDetail(db, month) {
  const prev = shiftMonth(month, -1);
  return {
    month,
    ...monthTotals(db, month),
    previous: monthTotals(db, prev),
    categories: categoryBreakdown(db, month),
  };
}

const TX_COLUMNS = `
  t.id, t.account_id AS accountId, a.display_name AS accountName, a.masked_number AS accountMasked, a.type AS accountType,
  t.date, t.processed_date AS processedDate, t.description, t.original_amount AS originalAmount,
  t.original_currency AS originalCurrency, t.charged_amount AS amount, t.type, t.installment_number AS installmentNumber,
  t.installment_total AS installmentTotal, t.memo, ${EFF_CAT} AS categoryId, t.user_category_override AS overrideCategoryId,
  c.name AS categoryName, c.icon AS categoryIcon, c.type AS categoryType, t.tags, t.notes,
  t.is_recurring AS recurring, t.is_excluded AS excluded`;

export function transactions(db, f = {}) {
  const where = [];
  const params = [];
  if (isMonth(f.month)) {
    const [from, to] = bounds(db, f.month);
    where.push(`${EFF_DATE} >= ? AND ${EFF_DATE} < ?`);
    params.push(from, to);
  }
  if (f.from) { where.push(`${EFF_DATE} >= ?`); params.push(f.from); }
  if (f.to) { where.push(`${EFF_DATE} <= ?`); params.push(f.to); }
  if (f.account) { where.push('t.account_id = ?'); params.push(f.account); }
  if (f.category === 'none') where.push(`${EFF_CAT} IS NULL`);
  else if (f.category) { where.push(`${EFF_CAT} = ?`); params.push(f.category); }
  if (f.recurring) where.push('t.is_recurring = 1');
  if (f.min != null && f.min !== '') { where.push('ABS(t.charged_amount) >= ?'); params.push(Number(f.min)); }
  if (f.max != null && f.max !== '') { where.push('ABS(t.charged_amount) <= ?'); params.push(Number(f.max)); }
  const rows = all(db, `
    SELECT ${TX_COLUMNS} FROM transactions t
    JOIN accounts a ON a.id = t.account_id
    LEFT JOIN categories c ON c.id = ${EFF_CAT}
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY ${EFF_DATE} DESC, t.first_seen_at DESC, t.id DESC LIMIT 2000`, params);
  const q = f.q ? normalizeText(f.q) : '';
  return rows
    .map(txRow)
    .filter(r => !q || normalizeText(`${r.description} ${r.notes || ''} ${r.categoryName || ''} ${r.memo || ''}`).includes(q))
    .slice(0, 500);
}

const txRow = r => ({ ...r, tags: safeTags(r.tags), recurring: Boolean(r.recurring), excluded: Boolean(r.excluded) });

// What a card bill is made of: the card's transactions charged on that date
export function cardCharge(db, accountId, date) {
  const account = one(db, "SELECT id, display_name AS name, masked_number AS masked FROM accounts WHERE id = ? AND type = 'card'", [accountId]);
  if (!account) return null;
  const items = all(db, `
    SELECT ${TX_COLUMNS} FROM transactions t
    JOIN accounts a ON a.id = t.account_id
    LEFT JOIN categories c ON c.id = ${EFF_CAT}
    WHERE t.account_id = ? AND COALESCE(t.processed_date, t.date) = ?
    ORDER BY t.date DESC, t.id`, [accountId, date]).map(txRow);
  const bill = one(db, 'SELECT amount FROM card_charges WHERE account_id = ? AND charge_date = ?', [accountId, date]);
  return { account, date, amount: r2(bill ? bill.amount : -items.reduce((s, t) => s + t.amount, 0)), items };
}

function safeTags(s) {
  try {
    const v = JSON.parse(s || '[]');
    return Array.isArray(v) ? v.filter(x => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

export function transactionById(db, id) {
  const row = one(db, `SELECT ${TX_COLUMNS} FROM transactions t JOIN accounts a ON a.id = t.account_id
    LEFT JOIN categories c ON c.id = ${EFF_CAT} WHERE t.id = ?`, [id]);
  return row ? { ...row, tags: safeTags(row.tags), recurring: Boolean(row.recurring), excluded: Boolean(row.excluded) } : null;
}

// User input cleanup: trim, strip control characters, cap length. Rendering always uses textContent.
export function cleanText(s, max) {
  if (s == null) return null;
  const v = String(s).replace(/[\u0000-\u001f\u007f‎‏‪-‮]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
  return v || null;
}

export function updateTransaction(db, { id, categoryId, notes, tags, excluded, applyToMerchant }) {
  const tx = transactionById(db, id);
  if (!tx) return null;
  const sets = [];
  const params = [];
  if (categoryId !== undefined) {
    if (categoryId !== null && !one(db, 'SELECT id FROM categories WHERE id = ?', [categoryId])) throw new Error('unknown category');
    sets.push('user_category_override = ?');
    params.push(categoryId);
  }
  if (notes !== undefined) { sets.push('notes = ?'); params.push(cleanText(notes, 500)); }
  if (tags !== undefined) {
    const list = (Array.isArray(tags) ? tags : []).map(t => cleanText(t, 30)).filter(Boolean).slice(0, 10);
    sets.push('tags = ?');
    params.push(JSON.stringify([...new Set(list)]));
  }
  if (excluded !== undefined) { sets.push('is_excluded = ?'); params.push(excluded ? 1 : 0); }
  let applied = 0;
  if (sets.length) {
    sets.push("updated_at = datetime('now')");
    db.run(`UPDATE transactions SET ${sets.join(', ')} WHERE id = ?`, [...params, id]);
  }
  if (applyToMerchant && categoryId) applied = addMerchantRule(db, tx.description, categoryId);
  return { transaction: transactionById(db, id), applied };
}

// "Always categorize this merchant as X": an exact user rule, applied to all past matches
export function addMerchantRule(db, description, categoryId) {
  const pattern = normalizeText(description);
  db.run("DELETE FROM category_rules WHERE created_by = 'user' AND match_type = 'exact' AND pattern = ?", [pattern]);
  db.run("INSERT INTO category_rules (id, match_type, pattern, category_id, priority, created_by) VALUES (?, 'exact', ?, ?, 100, 'user')",
    [`user-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`, pattern, categoryId]);
  return recategorizeAll(db).changed;
}

// Re-run the rules on every transaction (does not touch per-transaction overrides... except
// exact user rules, which represent an explicit "always" choice for that merchant)
export function recategorizeAll(db) {
  const rules = sortRules(all(db, 'SELECT * FROM category_rules'));
  const userExact = new Map(rules.filter(r => r.created_by === 'user' && r.match_type === 'exact').map(r => [r.pattern, r.category_id]));
  let changed = 0;
  const update = db.prepare('UPDATE transactions SET category_id = ?, user_category_override = ? WHERE id = ?');
  for (const t of all(db, 'SELECT id, description, category_id, user_category_override FROM transactions')) {
    const forced = userExact.get(normalizeText(t.description));
    const cat = forced ?? categorize(t.description, rules) ?? t.category_id;
    const override = forced ? null : t.user_category_override;
    if (cat !== t.category_id || override !== t.user_category_override) {
      update.run([cat, override, t.id]);
      changed++;
    }
  }
  update.free();
  return { changed };
}

export function budget(db, month) {
  const prev = shiftMonth(month, -1);
  const spent = Object.fromEntries(categoryBreakdown(db, month).map(c => [c.id, c.amount]));
  const plans = Object.fromEntries(all(db, 'SELECT category_id, planned_amount FROM budgets WHERE month = ?', [month]).map(b => [b.category_id, b.planned_amount]));
  const prevPlans = Object.fromEntries(all(db, 'SELECT category_id, planned_amount FROM budgets WHERE month = ?', [prev]).map(b => [b.category_id, b.planned_amount]));
  const items = categories(db).filter(c => c.type === 'expense').map(c => ({
    id: c.id, name: c.name, icon: c.icon, fixed: Boolean(c.fixed),
    planned: plans[c.id] ?? null, previousPlanned: prevPlans[c.id] ?? null, spent: r2(spent[c.id] || 0),
  }));
  const sum = (list, k) => r2(list.reduce((s, i) => s + (i[k] || 0), 0));
  const fixed = items.filter(i => i.fixed);
  const variable = items.filter(i => !i.fixed);
  return {
    month,
    items,
    totals: {
      planned: sum(items, 'planned'), spent: sum(items, 'spent'),
      fixed: { planned: sum(fixed, 'planned'), spent: sum(fixed, 'spent') },
      variable: { planned: sum(variable, 'planned'), spent: sum(variable, 'spent') },
    },
    hasPrevious: Object.keys(prevPlans).length > 0,
  };
}

export function setBudget(db, month, items) {
  const valid = new Set(categories(db).filter(c => c.type === 'expense').map(c => c.id));
  const up = db.prepare('INSERT INTO budgets (category_id, month, planned_amount) VALUES (?, ?, ?) ON CONFLICT(category_id, month) DO UPDATE SET planned_amount = excluded.planned_amount');
  const del = db.prepare('DELETE FROM budgets WHERE category_id = ? AND month = ?');
  for (const { categoryId, amount } of items) {
    if (!valid.has(categoryId)) continue;
    const n = Number(amount);
    if (amount === null || amount === '' || !Number.isFinite(n) || n <= 0) del.run([categoryId, month]);
    else up.run([categoryId, month, Math.min(r2(n), 10_000_000)]);
  }
  up.free();
  del.free();
}

export function copyBudget(db, month) {
  db.run(`INSERT INTO budgets (category_id, month, planned_amount, rollover)
    SELECT category_id, ?, planned_amount, rollover FROM budgets WHERE month = ?
    ON CONFLICT(category_id, month) DO UPDATE SET planned_amount = excluded.planned_amount`, [month, shiftMonth(month, -1)]);
}

export function trends(db, { months = 6, today }) {
  const current = cycleMonth(today, cycleDay(db));
  const list = [];
  for (let i = months - 1; i >= 0; i--) {
    const m = shiftMonth(current, -i);
    list.push({ month: m, ...monthTotals(db, m) });
  }
  // Average per category over the complete months only
  const complete = list.slice(0, -1);
  const sums = {};
  for (const { month } of complete) {
    for (const c of categoryBreakdown(db, month)) {
      sums[c.id] ??= { id: c.id, name: c.name, icon: c.icon, total: 0, months: [] };
      sums[c.id].total += c.amount;
    }
  }
  for (const s of Object.values(sums)) {
    s.months = complete.map(({ month }) => r2(categoryBreakdown(db, month).find(c => c.id === s.id)?.amount || 0));
  }
  const averages = Object.values(sums)
    .map(s => ({ id: s.id, name: s.name, icon: s.icon, average: r2(s.total / Math.max(complete.length, 1)), months: s.months }))
    .sort((a, b) => b.average - a.average);
  return { months: list, averages, projection: projection(db, today) };
}

// End-of-month bank balance: today's balance + expected recurring items + card bills still due
// this month + variable spending at the current pace (only what is paid from the bank this month).
export function projection(db, today) {
  const [, end] = bounds(db, cycleMonth(today, cycleDay(db)));
  const ids = balanceAccountIds(db);
  const bank = ids.length ? one(db, `SELECT COALESCE(SUM(balance), 0) AS b FROM accounts WHERE id IN (${ids.map(() => '?').join(',')})`, ids).b : 0;
  const recurring = all(db, "SELECT merchant, typical_amount AS amount, next_expected AS date FROM recurring_items WHERE status = 'active' AND next_expected > ? AND next_expected < ?", [today, end]);
  // Card subscriptions are inside the card bill; keep only bank-side items
  const bankDescriptions = new Set(all(db, "SELECT DISTINCT t.description FROM transactions t JOIN accounts a ON a.id = t.account_id WHERE a.type != 'card'").map(r => r.description));
  const bankRecurring = recurring.filter(r => bankDescriptions.has(r.merchant));
  const cardBills = all(db, 'SELECT amount, charge_date AS date FROM card_charges WHERE charge_date > ? AND charge_date < ?', [today, end]);
  const expected = bankRecurring.reduce((s, r) => s + r.amount, 0) - cardBills.reduce((s, c) => s + c.amount, 0);
  return {
    today: r2(bank),
    projected: r2(bank + expected),
    items: [
      ...bankRecurring.map(r => ({ label: r.merchant, date: r.date, amount: r2(r.amount) })),
      ...cardBills.map(c => ({ label: 'חיוב כרטיס אשראי', date: c.date, amount: r2(-c.amount) })),
    ].sort((a, b) => a.date.localeCompare(b.date)),
  };
}

export function recurringAndInstallments(db, today) {
  const recurring = all(db, "SELECT id, merchant, typical_amount AS amount, cadence, next_expected AS nextDate, status FROM recurring_items ORDER BY status, typical_amount");
  // Latest payment per installment plan
  const rows = all(db, `
    SELECT t.description, t.account_id AS accountId, a.display_name AS accountName, t.installment_number AS number,
           t.installment_total AS total, -t.charged_amount AS payment, -t.original_amount AS fullAmount, ${EFF_DATE} AS date
    FROM transactions t JOIN accounts a ON a.id = t.account_id
    WHERE t.type = 'installments' AND t.installment_total IS NOT NULL ORDER BY ${EFF_DATE}`);
  const plans = new Map();
  for (const r of rows) plans.set(`${r.accountId}|${r.description}|${r.total}|${r.fullAmount}`, r);
  const installments = [...plans.values()].map(p => ({
    description: p.description, accountName: p.accountName, number: p.number, total: p.total,
    payment: r2(p.payment), fullAmount: r2(p.fullAmount), remainingCount: p.total - p.number,
    remainingAmount: r2((p.total - p.number) * p.payment), lastDate: p.date,
  })).filter(p => p.remainingCount >= 0).sort((a, b) => b.remainingAmount - a.remainingAmount);
  const monthlyFixed = recurring.filter(r => r.status === 'active' && r.amount < 0 && r.cadence === 'monthly').reduce((s, r) => s - r.amount, 0);
  return {
    recurring: recurring.map(r => ({ ...r, amount: r2(r.amount) })),
    installments,
    totals: {
      monthlyRecurring: r2(monthlyFixed),
      installmentsRemaining: r2(installments.reduce((s, i) => s + i.remainingAmount, 0)),
      installmentsMonthly: r2(installments.filter(i => i.remainingCount > 0).reduce((s, i) => s + i.payment, 0)),
    },
    today,
  };
}

export function exportCsv(db) {
  const rows = transactions(db, {});
  const head = ['date', 'processed_date', 'account', 'description', 'category', 'amount_ils', 'original_amount', 'original_currency', 'type', 'installment', 'notes', 'tags', 'excluded'];
  const esc = v => {
    let s = v == null ? '' : String(v);
    if (/^[=+\-@\t\r]/.test(s) && !/^-?\d/.test(s)) s = `'${s}`; // spreadsheet formula injection
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = rows.map(r => [r.date, r.processedDate, `${r.accountName} ${r.accountMasked}`, r.description, r.categoryName,
    r.amount, r.originalAmount, r.originalCurrency, r.type, r.installmentTotal ? `${r.installmentNumber}/${r.installmentTotal}` : '',
    r.notes, r.tags.join('|'), r.excluded ? 1 : 0].map(esc).join(','));
  return '﻿' + [head.join(','), ...lines].join('\n');
}
