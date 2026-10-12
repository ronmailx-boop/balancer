// Read models for the UI. All money is ILS; expenses are negative in the DB and returned positive here.
import { categorize, sortRules, normalizeText, ruleMatches } from '../shared/categorize.js';
import { detectRecurring, dismissedIds } from '../shared/recurring.js';
import { fixedPayments, fixedFor, splitBill } from './rolling.js';

// Installments count in the month they are charged; everything else by purchase date
const EFF_DATE = "COALESCE(CASE WHEN t.type = 'installments' THEN t.processed_date END, t.date)";
const EFF_CAT = 'COALESCE(t.user_category_override, t.category_id)';
// Counted = not excluded, and not a transfer/ignore category (card bills, moves between own accounts)
const COUNTED = "t.is_excluded = 0 AND COALESCE(c.type, 'expense') IN ('expense', 'income')";

// Transactions as counted in sums: a split transaction is replaced by its parts (same id, date and
// account; the part's amount and category). Use instead of "transactions t" in aggregates.
const COUNTED_TX = `(
  SELECT id, account_id, date, processed_date, type, description, charged_amount, category_id, user_category_override, is_excluded,
         installment_number, installment_total
  FROM transactions WHERE id NOT IN (SELECT transaction_id FROM transaction_splits)
  UNION ALL
  SELECT x.id, x.account_id, x.date, x.processed_date, x.type, x.description, s.amount, s.category_id, s.category_id, x.is_excluded,
         x.installment_number, x.installment_total
  FROM transaction_splits s JOIN transactions x ON x.id = s.transaction_id)`;

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
    FROM ${COUNTED_TX} t LEFT JOIN categories c ON c.id = ${EFF_CAT}
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
    FROM ${COUNTED_TX} t LEFT JOIN categories c ON c.id = ${EFF_CAT}
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
  const fixed = fixedPayments(db);
  return {
    total: r2(total),
    accounts: accounts.map(a => {
      const f = a.type === 'card' ? fixedFor(fixed, a.id) : 0;
      // A card's balance is minus its next bill; with rolling credit only the fixed payment leaves the bank
      return { ...a, inBalance: included.has(a.id), ...(f ? { fixedPayment: f, nextDebit: splitBill(-(a.balance || 0), f).debit } : {}) };
    }),
    partial: included.size < bankCount,
  };
}

// amount = what will actually leave the bank; with rolling credit that is the fixed monthly payment,
// and total / rolled show the full bill and the part that rolls over to next month.
export function upcomingCharges(db, today) {
  const fixed = fixedPayments(db);
  return all(db, `
    SELECT cc.account_id AS accountId, a.display_name AS name, a.masked_number AS masked, cc.charge_date AS date, cc.amount AS amount
    FROM card_charges cc JOIN accounts a ON a.id = cc.account_id
    WHERE cc.charge_date >= ? ORDER BY cc.charge_date`, [today]).map(c => {
    const f = fixedFor(fixed, c.accountId);
    const { debit, rolled } = splitBill(c.amount, f);
    const rollingHint = !f && Boolean(one(db, "SELECT 1 AS x FROM transactions WHERE account_id = ? AND COALESCE(processed_date, date) = ? AND description LIKE '%מתגלגל%'", [c.accountId, c.date]));
    return { ...c, amount: debit, total: r2(c.amount), rolled, fixed: f || null, fixedSource: f ? fixed[c.accountId].source : null, rollingHint };
  });
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
    insights: insights(db, { month, today }),
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
    SELECT ${EFF_CAT} AS cat, -t.charged_amount AS amount FROM ${COUNTED_TX} t LEFT JOIN categories c ON c.id = ${EFF_CAT}
    WHERE ${COUNTED} AND c.type = 'expense' AND t.charged_amount < 0 AND t.type != 'installments' AND ${EFF_DATE} >= ? AND ${EFF_DATE} < ?`,
  [bounds(db, shiftMonth(month, -6))[0], from]);
  const byCat = {};
  for (const h of history) (byCat[h.cat] ??= []).push(h.amount);
  const current = all(db, `
    SELECT t.id, t.description, -t.charged_amount AS amount, ${EFF_CAT} AS cat FROM ${COUNTED_TX} t LEFT JOIN categories c ON c.id = ${EFF_CAT}
    WHERE ${COUNTED} AND c.type = 'expense' AND t.charged_amount < 0 AND t.type != 'installments' AND c.is_fixed = 0
      AND ${EFF_DATE} >= ? AND ${EFF_DATE} < ?`, [from, to]);
  for (const t of current) {
    const list = byCat[t.cat];
    if (!list || list.length < 4) continue;
    const median = [...list].sort((a, b) => a - b)[Math.floor(list.length / 2)];
    if (t.amount > Math.max(median * 3, 150)) out.push({ level: 'warning', kind: 'unusual', transactionId: t.id, text: `חיוב חריג: ${t.description} ${fmt(t.amount)}` });
  }
  // Card bills larger than the bank balance
  // Recurring items: a price rise in this cycle, or an expected charge / income that has not arrived
  const daysBetween = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / 86400000);
  for (const r of all(db, "SELECT merchant, typical_amount, last_amount, previous_amount, last_date, next_expected, cadence FROM recurring_items WHERE status = 'active'")) {
    const last = Math.abs(r.last_amount || 0);
    const prevAmt = Math.abs(r.previous_amount || 0);
    if (r.last_amount < 0 && prevAmt > 0 && last > prevAmt * 1.05 && last - prevAmt >= 2 && r.last_date >= from && r.last_date < to) {
      out.push({ level: 'warning', kind: 'price_up', text: `${r.merchant} התייקר: ${fmt2(prevAmt)} ← ${fmt2(last)}` });
    }
    const late = daysBetween(r.next_expected, today);
    if (r.cadence !== 'weekly' && late >= 5 && cycleMonth(today, cycleDay(db)) === month) {
      out.push({ level: 'warning', kind: 'missing', text: r.typical_amount > 0 ? `${r.merchant} עוד לא נכנס (צפוי ב-${shortIso(r.next_expected)})` : `החיוב הקבוע ${r.merchant} עוד לא הגיע (צפוי ב-${shortIso(r.next_expected)})` });
    }
  }
  // Possible double charge: same card or account, same merchant, same amount, same day
  for (const d of all(db, `
    SELECT t.description, -t.charged_amount AS amount, t.date, COUNT(*) AS n FROM transactions t
    WHERE t.type = 'normal' AND t.is_excluded = 0 AND t.charged_amount <= -50 AND t.date >= ? AND t.date < ?
    GROUP BY t.account_id, t.source_hash, t.charged_amount, t.date HAVING COUNT(*) > 1`, [from, to])) {
    out.push({ level: 'warning', kind: 'duplicate', text: `חיוב כפול אפשרי: ${d.description} ${fmt(d.amount)} פעמיים ב-${shortIso(d.date)}` });
  }
  // Card bills still due in the current cycle, against the chosen bank balance
  const [, cycleEnd] = bounds(db, cycleMonth(today, cycleDay(db)));
  const due = charges.filter(c => c.date < cycleEnd).reduce((s, c) => s + c.amount, 0);
  if (due > 0 && balances.total < due) out.push({ level: 'critical', kind: 'balance', text: 'היתרה בעו"ש נמוכה מחיובי האשראי הקרובים' });
  const rank = { critical: 0, warning: 1 };
  return out.sort((a, b) => rank[a.level] - rank[b.level]).slice(0, 8);
}

// Short plain-language observations for the home screen. The current cycle is judged by its pace
// (variable spending only: rent on the 1st would distort it); a past cycle is compared as a whole.
export function insights(db, { month, today }) {
  const day = cycleDay(db);
  const [from, to] = bounds(db, month);
  const prevMonths = [1, 2, 3].map(i => shiftMonth(month, -i));
  const history = prevMonths.map(m => categoryBreakdown(db, m)).filter(list => list.length > 0);
  if (!history.length) return [];
  const avgBy = {};
  for (const list of history) for (const c of list) avgBy[c.id] = (avgBy[c.id] || 0) + c.amount / history.length;
  const current = categoryBreakdown(db, month);
  const isCurrent = cycleMonth(today, day) === month;
  const out = [];

  if (isCurrent) {
    const span = (Date.parse(to) - Date.parse(from)) / 86400000;
    const elapsed = Math.min(span, (Date.parse(today) - Date.parse(from)) / 86400000 + 1);
    const share = elapsed / span;
    if (share >= 0.2 && share < 1) {
      const variableNow = current.filter(c => !c.fixed).reduce((s, c) => s + c.amount, 0);
      const variableAvg = history.reduce((s, list) => s + list.filter(c => !c.fixed).reduce((x, c) => x + c.amount, 0), 0) / history.length;
      const projected = variableNow / share;
      const diff = projected - variableAvg;
      if (variableAvg > 0 && Math.abs(diff) > variableAvg * 0.1 && Math.abs(diff) >= 200) {
        out.push({ icon: diff > 0 ? '📈' : '📉', level: diff > 0 ? 'warning' : 'good',
          text: `בקצב הנוכחי ההוצאות המשתנות יגיעו החודש לכ-${fmt(projected)}, ${fmt(Math.abs(diff))} ${diff > 0 ? 'יותר' : 'פחות'} מהממוצע.` });
      }
    }
    for (const c of current.filter(x => !x.fixed && avgBy[x.id] > 0 && x.amount > avgBy[x.id] && x.amount - avgBy[x.id] >= 150)
      .sort((a, b) => (b.amount - avgBy[b.id]) - (a.amount - avgBy[a.id])).slice(0, 2)) {
      out.push({ icon: c.icon || '❔', level: 'warning', categoryId: c.id,
        text: `על ${c.name} הוצאת כבר ${fmt(c.amount)}, יותר מכל החודש בממוצע (${fmt(avgBy[c.id])}).` });
    }
  } else {
    const changes = current.filter(c => avgBy[c.id] > 0).map(c => ({ c, diff: c.amount - avgBy[c.id] }))
      .filter(x => Math.abs(x.diff) >= 200 && Math.abs(x.diff) > avgBy[x.c.id] * 0.25)
      .sort((a, b) => Math.abs(b.diff) - Math.abs(a.diff)).slice(0, 3);
    for (const { c, diff } of changes) {
      out.push({ icon: c.icon || '❔', level: diff > 0 ? 'warning' : 'good', categoryId: c.id,
        text: `${c.name}: ${fmt(c.amount)}, ${fmt(Math.abs(diff))} ${diff > 0 ? 'יותר' : 'פחות'} מהממוצע של 3 החודשים שלפני.` });
    }
  }
  const subs = all(db, "SELECT typical_amount AS amount FROM recurring_items WHERE status = 'active' AND cadence = 'monthly' AND typical_amount < 0");
  if (subs.length >= 3) {
    out.push({ icon: '🔁', level: 'info', link: 'recurring',
      text: `${subs.length} חיובים חודשיים קבועים בסך ${fmt(-subs.reduce((s, r) => s + r.amount, 0))} בחודש.` });
  }
  return out.slice(0, 4);
}

const fmt = n => `₪${Math.round(n).toLocaleString('he-IL')}`;
const fmt2 = n => `₪${n.toLocaleString('he-IL', { minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2 })}`;
const shortIso = iso => `${Number(iso.slice(8, 10))}.${Number(iso.slice(5, 7))}`;

export function monthDetail(db, month) {
  const prev = shiftMonth(month, -1);
  return {
    month,
    ...monthTotals(db, month),
    previous: monthTotals(db, prev),
    categories: categoryBreakdown(db, month),
  };
}

// What makes up a month's income, expenses and what is left: the counted movements by category,
// and what was left out of the sums (card bills and transfers, excluded transactions).
export function monthFlow(db, month) {
  const [from, to] = bounds(db, month);
  const rows = all(db, `
    SELECT t.id, t.date, ${EFF_DATE} AS effDate, t.description, t.type, t.charged_amount AS amount, ${EFF_CAT} AS categoryId,
           c.name AS categoryName, c.icon AS categoryIcon, COALESCE(c.type, 'expense') AS categoryType, t.is_excluded AS excluded,
           a.display_name AS accountName, a.masked_number AS accountMasked,
           t.installment_number AS installmentNumber, t.installment_total AS installmentTotal
    FROM ${COUNTED_TX} t JOIN accounts a ON a.id = t.account_id LEFT JOIN categories c ON c.id = ${EFF_CAT}
    WHERE ${EFF_DATE} >= ? AND ${EFF_DATE} < ?
    ORDER BY ${EFF_DATE} DESC, ABS(t.charged_amount) DESC`, [from, to]);
  const side = type => {
    const items = rows.filter(r => !r.excluded && r.categoryType === type)
      .map(r => ({ ...r, amount: r2(type === 'income' ? r.amount : -r.amount), excluded: false }));
    const byCat = new Map();
    for (const r of items) {
      const k = r.categoryId ?? 'none';
      const c = byCat.get(k) || { id: r.categoryId, name: r.categoryName || 'ללא קטגוריה', icon: r.categoryIcon || '❔', amount: 0, count: 0 };
      c.amount = r2(c.amount + r.amount);
      c.count++;
      byCat.set(k, c);
    }
    return { total: r2(items.reduce((s, r) => s + r.amount, 0)), categories: [...byCat.values()].sort((a, b) => b.amount - a.amount), items };
  };
  const sumOf = list => ({ count: list.length, amount: r2(list.reduce((s, r) => s + Math.abs(r.amount), 0)) });
  return {
    month,
    range: [from, to],
    income: side('income'),
    expense: side('expense'),
    notCounted: {
      transfers: sumOf(rows.filter(r => !r.excluded && (r.categoryType === 'transfer' || r.categoryType === 'ignore'))),
      excluded: sumOf(rows.filter(r => r.excluded)),
    },
  };
}

const TX_COLUMNS = `
  t.id, t.account_id AS accountId, a.display_name AS accountName, a.masked_number AS accountMasked, a.type AS accountType,
  t.date, t.processed_date AS processedDate, t.description, t.original_amount AS originalAmount,
  t.original_currency AS originalCurrency, t.charged_amount AS amount, t.type, t.installment_number AS installmentNumber,
  t.installment_total AS installmentTotal, t.memo, ${EFF_CAT} AS categoryId, t.user_category_override AS overrideCategoryId,
  c.name AS categoryName, c.icon AS categoryIcon, c.type AS categoryType, t.tags, t.notes,
  t.is_recurring AS recurring, t.is_excluded AS excluded,
  (SELECT COUNT(*) FROM transaction_splits s WHERE s.transaction_id = t.id) AS splitCount`;

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
  else if (f.category) {
    where.push(`(${EFF_CAT} = ? OR t.id IN (SELECT transaction_id FROM transaction_splits WHERE category_id = ?))`);
    params.push(f.category, f.category);
  }
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

const txRow = r => ({ ...r, tags: safeTags(r.tags), recurring: Boolean(r.recurring), excluded: Boolean(r.excluded), split: r.splitCount > 0 });

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
  const total = r2(bill ? bill.amount : -items.reduce((s, t) => s + t.amount, 0));
  const f = fixedPayments(db)[accountId];
  const { debit, rolled } = splitBill(total, f?.amount || 0);
  // Max lists the rolled-over balance as a line of the bill ("יתרת אשראי מתגלגל")
  const rollingHint = items.some(t => /מתגלגל/.test(t.description));
  return { account, date, amount: total, debit, rolled, fixed: f && f.amount > 0 ? f.amount : null, fixedSource: f?.source || null, rollingHint, items };
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
  if (!row) return null;
  const splits = all(db, `SELECT s.category_id AS categoryId, s.amount, c.name AS categoryName, c.icon AS categoryIcon
    FROM transaction_splits s LEFT JOIN categories c ON c.id = s.category_id WHERE s.transaction_id = ? ORDER BY s.rowid`, [id])
    .map(x => ({ ...x, amount: r2(x.amount) }));
  return { ...txRow(row), splits };
}

// Split one transaction across categories. parts: [{ categoryId, amount }] with positive amounts;
// whatever is left stays in the transaction's own category. An empty list removes the split.
export function setSplits(db, id, parts) {
  const tx = transactionById(db, id);
  if (!tx) return null;
  // A pending item is replaced when it posts; split it after that
  if (tx.type === 'pending') throw new Error('pending');
  const total = Math.abs(tx.amount);
  const sign = tx.amount < 0 ? -1 : 1;
  const clean = [];
  for (const p of parts) {
    const amount = r2(Number(p.amount));
    if (!Number.isFinite(amount) || amount <= 0) throw new Error('bad amount');
    if (p.categoryId !== null && !one(db, 'SELECT id FROM categories WHERE id = ?', [p.categoryId])) throw new Error('unknown category');
    clean.push({ categoryId: p.categoryId, amount });
  }
  const used = r2(clean.reduce((s, p) => s + p.amount, 0));
  if (used > total + 0.004) throw new Error('parts exceed the amount');
  db.run('DELETE FROM transaction_splits WHERE transaction_id = ?', [id]);
  if (clean.length) {
    const rest = r2(total - used);
    if (rest > 0.004) clean.push({ categoryId: tx.categoryId ?? null, amount: rest });
    clean.forEach((p, i) => db.run('INSERT INTO transaction_splits (id, transaction_id, category_id, amount) VALUES (?, ?, ?, ?)',
      [`${id}-s${i}`, id, p.categoryId, sign * p.amount]));
  }
  return transactionById(db, id);
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

// ---- Category and rule management ----

const CATEGORY_TYPES = ['expense', 'income', 'transfer'];
const isCustom = id => typeof id === 'string' && id.startsWith('u-');
const newId = prefix => `${prefix}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

export class InputError extends Error {
  constructor(code) {
    super(code);
    this.code = code;
  }
}

export function manageCategories(db) {
  const counts = Object.fromEntries(all(db, `SELECT ${EFF_CAT} AS id, COUNT(*) AS n FROM transactions t GROUP BY ${EFF_CAT}`).map(r => [r.id, r.n]));
  const ruleCounts = Object.fromEntries(all(db, 'SELECT category_id AS id, COUNT(*) AS n FROM category_rules GROUP BY category_id').map(r => [r.id, r.n]));
  return {
    categories: categories(db).map(c => ({ ...c, fixed: Boolean(c.fixed), custom: isCustom(c.id), txCount: counts[c.id] || 0, ruleCount: ruleCounts[c.id] || 0 })),
    rules: all(db, `SELECT r.id, r.match_type AS matchType, r.pattern, r.category_id AS categoryId, c.name AS categoryName, c.icon AS categoryIcon
      FROM category_rules r JOIN categories c ON c.id = r.category_id WHERE r.created_by = 'user' ORDER BY c.sort_order, r.pattern`),
    systemRuleCount: one(db, "SELECT COUNT(*) AS n FROM category_rules WHERE created_by = 'system'").n,
  };
}

export function saveCategory(db, { id, name, icon, type, fixed }) {
  const cleanName = cleanText(name, 30);
  const cleanIcon = cleanText([...String(icon ?? '')].slice(0, 4).join(''), 16) || '🏷️';
  if (!cleanName) throw new InputError('bad_request');
  const existing = id ? one(db, 'SELECT id, type FROM categories WHERE id = ?', [id]) : null;
  if (id && !existing) throw new InputError('not_found');
  if (one(db, 'SELECT id FROM categories WHERE name = ? AND id != ?', [cleanName, id || ''])) throw new InputError('name_taken');
  if (existing) {
    // Built-in categories keep their type: card bills and transfers depend on it
    const newType = isCustom(id) && CATEGORY_TYPES.includes(type) ? type : existing.type;
    db.run('UPDATE categories SET name = ?, icon = ?, type = ?, is_fixed = ? WHERE id = ?', [cleanName, cleanIcon, newType, fixed ? 1 : 0, id]);
    return id;
  }
  if (!CATEGORY_TYPES.includes(type)) throw new InputError('bad_request');
  const created = newId('u');
  const order = one(db, 'SELECT COALESCE(MAX(sort_order), 0) + 1 AS n FROM categories').n;
  db.run('INSERT INTO categories (id, name, icon, type, is_fixed, sort_order) VALUES (?, ?, ?, ?, ?, ?)', [created, cleanName, cleanIcon, type, fixed ? 1 : 0, order]);
  return created;
}

// Only categories the user created can be deleted. Their transactions become uncategorized,
// and are then re-run through the rules.
export function deleteCategory(db, id) {
  if (!isCustom(id) || !one(db, 'SELECT id FROM categories WHERE id = ?', [id])) throw new InputError('not_found');
  db.run('DELETE FROM categories WHERE id = ?', [id]);
  const rules = sortRules(all(db, 'SELECT * FROM category_rules'));
  for (const t of all(db, 'SELECT id, description FROM transactions WHERE category_id IS NULL')) {
    const cat = categorize(t.description, rules);
    if (cat) db.run('UPDATE transactions SET category_id = ? WHERE id = ?', [cat, t.id]);
  }
}

export function addRule(db, { pattern, matchType, categoryId }) {
  const text = cleanText(pattern, 60);
  if (!text || !['contains', 'exact'].includes(matchType)) throw new InputError('bad_rule');
  if (!one(db, 'SELECT id FROM categories WHERE id = ?', [categoryId])) throw new InputError('bad_rule');
  const stored = normalizeText(text);
  db.run("DELETE FROM category_rules WHERE created_by = 'user' AND match_type = ? AND pattern = ?", [matchType, stored]);
  db.run("INSERT INTO category_rules (id, match_type, pattern, category_id, priority, created_by) VALUES (?, ?, ?, ?, 100, 'user')",
    [newId('user'), matchType, stored, categoryId]);
  // A new rule applies to past transactions too, except ones the user set by hand
  const rules = sortRules(all(db, 'SELECT * FROM category_rules'));
  const rule = rules.find(r => r.created_by === 'user' && r.match_type === matchType && r.pattern === stored);
  let changed = 0;
  for (const t of all(db, 'SELECT id, description, category_id, user_category_override FROM transactions')) {
    if (!ruleMatches(rule, t.description)) continue;
    const cat = categorize(t.description, rules);
    if (cat !== t.category_id) {
      db.run('UPDATE transactions SET category_id = ? WHERE id = ?', [cat, t.id]);
      if (!t.user_category_override) changed++;
    }
  }
  return changed;
}

// Removing a rule re-runs the remaining rules on the transactions it matched
export function deleteRule(db, id) {
  const rule = one(db, "SELECT * FROM category_rules WHERE id = ? AND created_by = 'user'", [id]);
  if (!rule) throw new InputError('not_found');
  db.run('DELETE FROM category_rules WHERE id = ?', [id]);
  const rules = sortRules(all(db, 'SELECT * FROM category_rules'));
  for (const t of all(db, 'SELECT id, description FROM transactions WHERE category_id = ?', [rule.category_id])) {
    if (ruleMatches(rule, t.description)) db.run('UPDATE transactions SET category_id = ? WHERE id = ?', [categorize(t.description, rules), t.id]);
  }
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
  const byMonth = complete.map(({ month }) => new Map(categoryBreakdown(db, month).map(c => [c.id, c])));
  const sums = {};
  for (const breakdown of byMonth) {
    for (const c of breakdown.values()) {
      sums[c.id] ??= { id: c.id, name: c.name, icon: c.icon, total: 0, months: [] };
      sums[c.id].total += c.amount;
    }
  }
  for (const s of Object.values(sums)) s.months = byMonth.map(b => r2(b.get(s.id)?.amount || 0));
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
  // Card subscriptions are inside the card bill; only bank-side items move the bank balance
  const bankRecurring = ids.length ? all(db, `SELECT merchant, typical_amount AS amount, next_expected AS date FROM recurring_items
    WHERE status = 'active' AND next_expected > ? AND next_expected < ? AND account_id IN (${ids.map(() => '?').join(',')})`, [today, end, ...ids]) : [];
  const fixed = fixedPayments(db);
  const cardBills = all(db, 'SELECT account_id, amount, charge_date AS date FROM card_charges WHERE charge_date > ? AND charge_date < ?', [today, end])
    .map(c => ({ ...c, amount: splitBill(c.amount, fixedFor(fixed, c.account_id)).debit }));
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

const PER_MONTH = { weekly: 52 / 12, monthly: 1, bimonthly: 0.5, yearly: 1 / 12 };

// "This is not a recurring charge" (or undo). Kept across re-detection by the item's id.
export function dismissRecurring(db, id, dismissed, today) {
  if (!one(db, 'SELECT id FROM recurring_items WHERE id = ?', [id])) return false;
  const set = dismissedIds(db);
  if (dismissed) set.add(id); else set.delete(id);
  db.run("INSERT OR REPLACE INTO settings (key, value) VALUES ('recurring_dismissed', ?)", [JSON.stringify([...set].slice(-500))]);
  detectRecurring(db, today);
  return true;
}

const planId = key => `ins-${hashText(key)}`;
const hashText = t => { let h = 2166136261; for (const c of t) h = Math.imul(h ^ c.codePointAt(0), 16777619) >>> 0; return h.toString(36); };

function installmentsHidden(db) {
  try {
    const v = JSON.parse(one(db, "SELECT value FROM settings WHERE key = 'installments_hidden'")?.value || '[]');
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

// "Paid off early": the plan leaves the active list and the monthly totals (or comes back)
export function hideInstallment(db, id, hidden) {
  const set = new Set(installmentsHidden(db));
  if (hidden) set.add(id); else set.delete(id);
  db.run("INSERT OR REPLACE INTO settings (key, value) VALUES ('installments_hidden', ?)", [JSON.stringify([...set].slice(-500))]);
}

export function recurringAndInstallments(db, today) {
  const fixed = fixedPayments(db);
  const recurring = all(db, `
    SELECT r.id, r.merchant, r.typical_amount AS amount, r.cadence, r.next_expected AS nextDate, r.status, r.last_date AS lastDate,
           r.last_amount AS lastAmount, r.previous_amount AS previousAmount, r.occurrences, a.display_name AS accountName,
           a.masked_number AS accountMasked, a.id AS accountId, a.type AS accountType, c.name AS categoryName, c.icon AS categoryIcon
    FROM recurring_items r LEFT JOIN accounts a ON a.id = r.account_id LEFT JOIN categories c ON c.id = r.category_id
    ORDER BY r.status, r.typical_amount`).map(r => {
    // The card's rolling-credit balance line: what is really paid each month is the fixed payment
    if (r.accountType !== 'card' || !/מתגלגל/.test(r.merchant)) return r;
    const f = fixedFor(fixed, r.accountId);
    return { ...r, rolling: true, rollingBalance: r2(r.amount), rollingFixed: f || null, amount: f ? -f : r.amount };
  });
  // Latest payment per installment plan
  const rows = all(db, `
    SELECT t.description, t.account_id AS accountId, a.display_name AS accountName, t.installment_number AS number,
           t.installment_total AS total, -t.charged_amount AS payment, -t.original_amount AS fullAmount, ${EFF_DATE} AS date
    FROM transactions t JOIN accounts a ON a.id = t.account_id
    WHERE t.type = 'installments' AND t.installment_total IS NOT NULL ORDER BY ${EFF_DATE}`);
  const plans = new Map();
  for (const r of rows) plans.set(`${r.accountId}|${r.description}|${r.total}|${r.fullAmount}`, r);
  const hidden = new Set(installmentsHidden(db));
  const allPlans = [...plans.entries()].map(([key, p]) => ({
    id: planId(key), description: p.description, accountName: p.accountName, number: p.number, total: p.total,
    payment: r2(p.payment), fullAmount: r2(p.fullAmount), remainingCount: p.total - p.number,
    remainingAmount: r2((p.total - p.number) * p.payment), lastDate: p.date,
  })).filter(p => p.remainingCount >= 0).sort((a, b) => b.remainingAmount - a.remainingAmount);
  // Active plans; plans the user marked as paid off, and plans past their last payment, are listed apart
  const installments = allPlans.filter(p => !hidden.has(p.id) && p.remainingCount > 0);
  const installmentsDone = allPlans.filter(p => hidden.has(p.id) || p.remainingCount === 0)
    .map(p => ({ ...p, paidOff: hidden.has(p.id) }));
  const monthlyFixed = recurring.filter(r => r.status === 'active' && r.amount < 0).reduce((s, r) => s - r.amount * (PER_MONTH[r.cadence] || 1), 0);
  const monthlyIncome = recurring.filter(r => r.status === 'active' && r.amount > 0).reduce((s, r) => s + r.amount * (PER_MONTH[r.cadence] || 1), 0);
  return {
    recurring: recurring.map(r => ({ ...r, amount: r2(r.amount) })).sort((a, b) => (a.status === b.status ? a.amount - b.amount : 0)),
    installments,
    installmentsDone,
    totals: {
      monthlyRecurring: r2(monthlyFixed),
      monthlyRecurringIncome: r2(monthlyIncome),
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
