// Converts israeli-bank-scrapers output into Balancer's schema. Pure functions, no DB.
import crypto from 'node:crypto';
import { normalizeText } from './categorize.js';

const hash = (...parts) => crypto.createHash('sha256').update(parts.join('\u001f')).digest('hex').slice(0, 24);

// The library returns ISO timestamps (Israeli midnight expressed in UTC). Convert to the Israeli calendar day.
const dayFmt = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jerusalem', year: 'numeric', month: '2-digit', day: '2-digit' });
export function israelDay(iso) {
  if (!iso) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : dayFmt.format(d);
}

export function maskAccountNumber(n) {
  const digits = String(n ?? '').replace(/\D/g, '');
  return digits.slice(-4) || '0000';
}

export const accountId = (connectionId, accountNumber) => `acc-${hash(connectionId, String(accountNumber))}`;

const round2 = n => Math.round((Number(n) || 0) * 100) / 100;

export function normalizeTransaction(t, accId, occurrence = 0) {
  const date = israelDay(t.date);
  const processed = israelDay(t.processedDate);
  const pending = t.status === 'pending';
  const installments = t.type === 'installments' && t.installments?.total > 1 ? t.installments : null;
  const description = String(t.description ?? '').replace(/\s+/g, ' ').trim() || '—';
  const charged = round2(t.chargedAmount ?? t.originalAmount);
  const identifier = t.identifier != null && String(t.identifier).trim() !== '' ? String(t.identifier) : null;
  const instNo = installments ? installments.number : '';

  // Stable ids so repeated scrapes update instead of duplicating.
  // Pending items have no reliable identity; they get a separate namespace and are reconciled on merge.
  let id;
  if (pending) id = `p-${hash(accId, 'pending', date, charged, normalizeText(description), occurrence)}`;
  else if (identifier) id = `t-${hash(accId, 'id', identifier, instNo, installments ? '' : date)}`;
  else id = `t-${hash(accId, date, charged, normalizeText(description), instNo, occurrence)}`;

  return {
    id,
    account_id: accId,
    date,
    processed_date: processed,
    description,
    original_amount: round2(t.originalAmount ?? charged),
    original_currency: (t.originalCurrency || 'ILS').toUpperCase().replace('₪', 'ILS').replace('NIS', 'ILS'),
    charged_amount: charged,
    type: pending ? 'pending' : installments ? 'installments' : 'normal',
    installment_number: installments?.number ?? null,
    installment_total: installments?.total ?? null,
    memo: t.memo ? String(t.memo).trim().slice(0, 300) || null : null,
    source_identifier: identifier,
    source_hash: normalizeText(description),
  };
}

export function normalizeResult({ connectionId, kind, result, today }) {
  const accounts = [];
  const transactions = [];
  const cardCharges = [];
  for (const a of result.accounts || []) {
    const accId = accountId(connectionId, a.accountNumber);
    const seen = new Map();
    const txns = (a.txns || []).filter(t => israelDay(t.date)).map(t => {
      // Identical lines on the same day (two coffees) are told apart by their order
      const key = [israelDay(t.date), round2(t.chargedAmount), normalizeText(t.description || ''), t.status, t.identifier ?? ''].join('|');
      const occ = seen.get(key) || 0;
      seen.set(key, occ + 1);
      return normalizeTransaction(t, accId, occ);
    });
    transactions.push(...txns);

    let balance = typeof a.balance === 'number' ? round2(a.balance) : null;
    if (kind === 'card') {
      // Upcoming card bills: everything whose charge date is today or later, grouped by charge date
      const byDate = new Map();
      for (const t of txns) {
        const when = t.processed_date || t.date;
        if (when >= today) byDate.set(when, round2((byDate.get(when) || 0) - t.charged_amount));
      }
      for (const [date, amount] of byDate) if (amount > 0) cardCharges.push({ account_id: accId, charge_date: date, amount });
      const next = [...byDate.entries()].sort(([x], [y]) => x.localeCompare(y))[0];
      balance = next ? -next[1] : 0;
    }
    accounts.push({
      id: accId,
      connection_id: connectionId,
      masked_number: maskAccountNumber(a.accountNumber),
      type: kind === 'card' ? 'card' : 'checking',
      balance,
    });
  }
  return { accounts, transactions, cardCharges };
}

// A pending item and the posted transaction that replaced it: same merchant,
// amount within 10% (or ₪1), and dates within 10 days.
export function isSameCharge(pending, posted) {
  if (pending.account_id !== posted.account_id) return false;
  if (pending.source_hash !== posted.source_hash) return false;
  const a = Math.abs(pending.charged_amount);
  const b = Math.abs(posted.charged_amount);
  if (Math.abs(a - b) > Math.max(1, a * 0.1)) return false;
  const days = Math.abs(new Date(pending.date) - new Date(posted.date)) / 86400000;
  return days <= 10;
}
