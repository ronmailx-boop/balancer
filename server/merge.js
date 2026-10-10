// Writes a normalized scrape into the database: upserts, pending reconciliation, card bills.
import { all } from './queries.js';
import { categorize, sortRules } from '../shared/categorize.js';
import { isSameCharge } from '../shared/normalize.js';

const USER_FIELDS = ['user_category_override', 'notes', 'tags', 'is_excluded', 'is_recurring', 'first_seen_at'];

export function mergeScrape(db, { connectionId, displayName, normalized, startDay }) {
  const rules = sortRules(all(db, 'SELECT * FROM category_rules'));
  const stats = { added: 0, updated: 0, pendingResolved: 0, pendingRemoved: 0 };
  const nowIso = new Date().toISOString();

  db.run('BEGIN');
  try {
    // Accounts
    const multi = normalized.accounts.length > 1;
    for (const a of normalized.accounts) {
      const exists = all(db, 'SELECT id FROM accounts WHERE id = ?', [a.id]).length > 0;
      if (exists) {
        db.run('UPDATE accounts SET balance = ?, masked_number = ?, updated_at = ? WHERE id = ?', [a.balance, a.masked_number, nowIso, a.id]);
      } else {
        const name = multi ? `${displayName} ${a.masked_number}` : displayName;
        db.run('INSERT INTO accounts (id, connection_id, display_name, masked_number, type, balance, currency, updated_at) VALUES (?, ?, ?, ?, ?, ?, \'ILS\', ?)',
          [a.id, connectionId, name, a.masked_number, a.type, a.balance, nowIso]);
      }
    }

    const accountIds = normalized.accounts.map(a => a.id);
    const incomingIds = new Set(normalized.transactions.map(t => t.id));

    // Pending items of these accounts that this scrape no longer reports (inside the scraped range)
    const stalePending = accountIds.length ? all(db, `SELECT * FROM transactions WHERE type = 'pending' AND date >= ? AND account_id IN (${accountIds.map(() => '?').join(',')})`,
      [startDay, ...accountIds]).filter(p => !incomingIds.has(p.id)) : [];
    const consumed = new Set();

    for (const t of normalized.transactions) {
      const existing = all(db, 'SELECT * FROM transactions WHERE id = ?', [t.id])[0];
      if (existing) {
        db.run(`UPDATE transactions SET processed_date = ?, description = ?, original_amount = ?, original_currency = ?,
          charged_amount = ?, type = ?, installment_number = ?, installment_total = ?, memo = ?, source_identifier = ?,
          source_hash = ?, category_id = COALESCE(category_id, ?), updated_at = datetime('now') WHERE id = ?`,
        [t.processed_date, t.description, t.original_amount, t.original_currency, t.charged_amount, t.type,
          t.installment_number, t.installment_total, t.memo, t.source_identifier, t.source_hash, categorize(t.description, rules), t.id]);
        stats.updated++;
        continue;
      }
      // Carry the user's edits over from the pending item this transaction replaces
      const prev = stalePending.find(p => !consumed.has(p.id) && isSameCharge(p, t));
      const carried = prev ? Object.fromEntries(USER_FIELDS.map(f => [f, prev[f]])) : {};
      if (prev) {
        consumed.add(prev.id);
        stats.pendingResolved++;
      }
      db.run(`INSERT INTO transactions (id, account_id, date, processed_date, description, original_amount, original_currency,
        charged_amount, type, installment_number, installment_total, memo, category_id, user_category_override, tags, notes,
        is_recurring, is_excluded, source_identifier, source_hash, first_seen_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, COALESCE(?, datetime('now')))`,
      [t.id, t.account_id, t.date, t.processed_date, t.description, t.original_amount, t.original_currency, t.charged_amount,
        t.type, t.installment_number, t.installment_total, t.memo, categorize(t.description, rules),
        carried.user_category_override ?? null, carried.tags ?? '[]', carried.notes ?? null,
        carried.is_recurring ?? 0, carried.is_excluded ?? 0, t.source_identifier, t.source_hash, carried.first_seen_at ?? null]);
      stats.added++;
    }

    for (const p of stalePending) {
      db.run('DELETE FROM transactions WHERE id = ?', [p.id]);
      if (!consumed.has(p.id)) stats.pendingRemoved++;
    }

    // Upcoming card bills are replaced wholesale on every scrape
    for (const id of accountIds) db.run('DELETE FROM card_charges WHERE account_id = ?', [id]);
    for (const c of normalized.cardCharges) {
      db.run('INSERT INTO card_charges (account_id, charge_date, amount) VALUES (?, ?, ?) ON CONFLICT(account_id, charge_date) DO UPDATE SET amount = excluded.amount',
        [c.account_id, c.charge_date, c.amount]);
    }
    db.run('COMMIT');
  } catch (e) {
    db.run('ROLLBACK');
    throw e;
  }
  return stats;
}
