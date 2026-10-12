// Rolling credit ("אשראי מתגלגל"): a card with a fixed monthly payment. The bank is debited the fixed
// amount and the rest of the bill rolls over to the next month. The bank scrapers do not report the
// fixed amount, so it is detected from the card debits on the bank account, or set by the user.
// Stored in settings.card_fixed_payments: { [cardAccountId]: { amount, source: 'auto' | 'user' } };
// amount 0 from the user means "no rolling credit on this card".

const KEY = 'card_fixed_payments';
const PROVIDER_WORDS = {
  max: ['מקס', 'MAX'],
  visaCal: ['כאל', 'CAL'],
  isracard: ['ישראכרט', 'ISRACARD'],
  amex: ['אמריקן', 'AMEX', 'אמקס'],
  beyahadBishvilha: ['ביחד'],
  behatsdaa: ['בהצדעה'],
};

const r2 = n => Math.round(n * 100) / 100;
const DAY = 86400000;

function rows(db, sql, params = []) {
  const stmt = db.prepare(sql);
  try {
    stmt.bind(params);
    const out = [];
    while (stmt.step()) out.push(stmt.getAsObject());
    return out;
  } finally {
    stmt.free();
  }
}

export function fixedPayments(db) {
  const v = rows(db, 'SELECT value FROM settings WHERE key = ?', [KEY])[0]?.value;
  try {
    const parsed = JSON.parse(v || '{}');
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function save(db, map) {
  db.run('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)', [KEY, JSON.stringify(map)]);
}

// The user's own value always wins over detection. amount null removes the user's value.
export function setFixedPayment(db, accountId, amount) {
  const map = fixedPayments(db);
  if (amount == null) delete map[accountId];
  else map[accountId] = { amount: r2(amount), source: 'user' };
  save(db, map);
}

// What actually leaves the bank on a bill: the fixed amount when the bill is larger, else the bill.
export function splitBill(total, fixed) {
  if (!fixed || fixed <= 0 || total <= fixed) return { debit: r2(total), rolled: 0 };
  return { debit: r2(fixed), rolled: r2(total - fixed) };
}

export function fixedFor(map, accountId) {
  const f = map[accountId];
  return f && f.amount > 0 ? f.amount : 0;
}

// Detection: the bank debits for a card (matched by provider name, and by the card's last 4 digits
// when the provider has several cards) are about the same amount in the last months, while the
// card's own bills were clearly larger. That amount is the fixed monthly payment.
export function detectFixedPayments(db, today) {
  const since = new Date(Date.parse(today) - 130 * DAY).toISOString().slice(0, 10);
  const cards = rows(db, `SELECT a.id, a.masked_number AS masked, c.provider FROM accounts a JOIN connections c ON c.id = a.connection_id WHERE a.type = 'card'`);
  const debits = rows(db, `SELECT t.date, t.description, -t.charged_amount AS amount FROM transactions t JOIN accounts a ON a.id = t.account_id
    WHERE a.type != 'card' AND t.charged_amount < 0 AND t.date >= ? AND t.date <= ?
      AND COALESCE(t.user_category_override, t.category_id) = 'card_payment'`, [since, today]);
  const map = fixedPayments(db);
  const found = {};
  for (const card of cards) {
    const words = PROVIDER_WORDS[card.provider];
    if (!words) continue;
    const sameProvider = cards.filter(c => c.provider === card.provider).length;
    const mine = debits.filter(d => {
      const text = d.description.toUpperCase();
      if (!words.some(w => text.includes(w.toUpperCase()))) return false;
      // Several cards of the same company: only a debit that names this card's digits counts
      return sameProvider === 1 || (card.masked && d.description.includes(card.masked));
    });
    if (mine.length < 2) continue;
    const recent = mine.sort((a, b) => a.date.localeCompare(b.date)).slice(-3);
    const amounts = recent.map(d => d.amount);
    const typical = [...amounts].sort((a, b) => a - b)[Math.floor(amounts.length / 2)];
    if (!amounts.every(a => Math.abs(a - typical) <= Math.max(5, typical * 0.03))) continue;
    // The card's bill around each debit date must have been larger than what the bank paid
    const rolledMonths = recent.filter(d => {
      const from = new Date(Date.parse(d.date) - 5 * DAY).toISOString().slice(0, 10);
      const to = new Date(Date.parse(d.date) + 5 * DAY).toISOString().slice(0, 10);
      const bill = -(rows(db, `SELECT COALESCE(SUM(charged_amount), 0) AS s FROM transactions
        WHERE account_id = ? AND type != 'pending' AND COALESCE(processed_date, date) BETWEEN ? AND ?`, [card.id, from, to])[0].s);
      return bill > d.amount + 50;
    }).length;
    if (rolledMonths >= 1) found[card.id] = r2(typical);
  }
  let changed = false;
  for (const card of cards) {
    if (map[card.id]?.source === 'user') continue;
    if (found[card.id]) {
      if (map[card.id]?.amount !== found[card.id]) changed = true;
      map[card.id] = { amount: found[card.id], source: 'auto' };
    } else if (map[card.id]) {
      delete map[card.id];
      changed = true;
    }
  }
  if (changed) save(db, map);
  return found;
}
