import { api } from '../api.js';
import { h, card, cardTitle, money, emptyState } from '../ui.js';

export const title = 'חשבונות וחיבורים';
export const back = 'more';

const STATUS = {
  ok: ['good', '✅', 'מחובר'],
  syncing: ['good', '🔄', 'מסנכרן…'],
  needs_attention: ['critical', '⛔', 'דורש טיפול: פרטי ההתחברות לא התקבלו'],
  otp_required: ['warning', '⚠️', 'נדרש קוד אימות'],
  error: ['critical', '⛔', 'שגיאה בסנכרון האחרון'],
};

export async function render() {
  const { accounts } = await api('accounts');
  const add = h('button', { type: 'button', class: 'btn', disabled: true }, '➕ הוספת בנק או כרטיס (שלב 3)');
  if (!accounts.length) return [emptyState('🏦', 'אין חשבונות מחוברים', 'חיבור ללאומי, כאל ומקס יתווסף בשלב 3.'), add];
  const byConn = new Map();
  for (const a of accounts) {
    if (!byConn.has(a.connectionId)) byConn.set(a.connectionId, { ...a, accounts: [] });
    byConn.get(a.connectionId).accounts.push(a);
  }
  return [
    [...byConn.values()].map(c => {
      const [level, icon, label] = STATUS[c.status] || STATUS.error;
      return card(cardTitle(c.connectionName, h('span', { class: 'badge' }, c.kind === 'bank' ? 'בנק' : 'כרטיס אשראי')),
        h('p', { class: `status-label ${level}` }, icon, ' ', label),
        h('p', { class: 'muted small' }, `סנכרון אחרון: ${c.lastSyncAt ? new Date(c.lastSyncAt).toLocaleString('he-IL', { dateStyle: 'short', timeStyle: 'short' }) : 'אף פעם'}`),
        h('ul', { class: 'list' }, c.accounts.map(a => h('li', { class: 'list-row' },
          h('span', { class: 'list-main' }, h('span', {}, a.name), h('span', { class: 'muted small' }, `••${a.masked}`)),
          h('span', { class: 'list-amount' }, a.type === 'card' ? money(-a.balance) : money(a.balance))))),
        h('button', { type: 'button', class: 'btn', disabled: true }, 'סנכרון עכשיו (שלב 3)'));
    }),
    add,
  ];
}
