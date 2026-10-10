import { api } from '../api.js';
import { h, card, cardTitle, money, shortDate, emptyState } from '../ui.js';

export const title = 'הוראות קבע ותשלומים';
export const back = 'more';

const CADENCE = { weekly: 'שבועי', monthly: 'חודשי', bimonthly: 'דו-חודשי', yearly: 'שנתי' };

export async function render() {
  const r = await api('recurring');
  if (!r.recurring.length && !r.installments.length) return emptyState('🔁', 'אין עדיין חיובים קבועים', 'אחרי כמה חודשים של נתונים, חיובים חוזרים יזוהו אוטומטית (שלב 4).');
  const active = r.recurring.filter(x => x.status === 'active');
  return [
    card(cardTitle('סיכום'),
      h('div', { class: 'stats' },
        h('div', { class: 'stat' }, h('span', { class: 'stat-label' }, 'קבועות בחודש'), h('span', { class: 'stat-value' }, money(r.totals.monthlyRecurring))),
        h('div', { class: 'stat' }, h('span', { class: 'stat-label' }, 'תשלומים בחודש'), h('span', { class: 'stat-value' }, money(r.totals.installmentsMonthly))),
        h('div', { class: 'stat' }, h('span', { class: 'stat-label' }, 'יתרת תשלומים'), h('span', { class: 'stat-value' }, money(r.totals.installmentsRemaining))))),
    r.installments.length > 0 && card(cardTitle('עסקאות בתשלומים'),
      h('ul', { class: 'list' }, r.installments.map(i => h('li', { class: 'list-row installment' },
        h('span', { class: 'list-main' },
          h('span', {}, i.description),
          h('span', { class: 'muted small' }, `${i.accountName} · ${i.number} מתוך ${i.total} · ${money(i.payment)} לחודש`),
          h('span', { class: 'mini-progress', role: 'img', 'aria-label': `שולמו ${i.number} מתוך ${i.total}` },
            h('span', { style: { width: `${i.number / i.total * 100}%` } }))),
        h('span', { class: 'list-amount' }, h('span', {}, money(i.remainingAmount)), h('span', { class: 'muted small' }, `נשארו ${i.remainingCount}`)))))),
    active.length > 0 && card(cardTitle('חיובים והכנסות קבועים'),
      h('ul', { class: 'list' }, active.map(x => h('li', { class: 'list-row' },
        h('span', { class: 'list-main' }, h('span', {}, x.merchant), h('span', { class: 'muted small' }, `${CADENCE[x.cadence] || x.cadence} · הבא ${x.nextDate ? shortDate(x.nextDate) : '—'}`)),
        h('span', { class: `list-amount ${x.amount > 0 ? 'pos' : ''}` }, money(x.amount, { sign: x.amount > 0 })))))),
  ];
}
