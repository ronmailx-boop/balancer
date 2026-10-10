import { api, messageFor } from '../api.js';
import { h, card, cardTitle, money, shortDate, emptyState, openSheet, toast, accountLabel } from '../ui.js';

export const title = 'הוראות קבע ותשלומים';
export const back = 'more';

const CADENCE = { weekly: 'שבועי', monthly: 'חודשי', bimonthly: 'דו-חודשי', yearly: 'שנתי' };

export async function render(ctx) {
  const r = await api('recurring');
  if (!r.recurring.length && !r.installments.length) {
    return emptyState('🔁', 'אין עדיין חיובים קבועים', 'חיובים והכנסות שחוזרים כל חודש יזוהו אוטומטית אחרי כ-3 חודשים של נתונים.');
  }
  const active = r.recurring.filter(x => x.status === 'active');
  const expenses = active.filter(x => x.amount < 0);
  const income = active.filter(x => x.amount > 0);
  const inactive = r.recurring.filter(x => x.status !== 'active');
  const row = x => h('li', {},
    h('button', { type: 'button', class: 'list-row list-button', onclick: () => openItem(ctx, x) },
      h('span', { class: 'list-icon', 'aria-hidden': 'true' }, x.categoryIcon || '🔁'),
      h('span', { class: 'list-main' },
        h('span', {}, x.merchant),
        h('span', { class: 'muted small' }, `${CADENCE[x.cadence] || x.cadence} · ${x.status === 'active' ? `הבא ${shortDate(x.nextDate)}` : x.status === 'paused' ? 'סומן כלא קבוע' : `אחרון ${shortDate(x.lastDate)}`}`),
        priceUp(x) && h('span', { class: 'status-label small warning' }, '⚠️ התייקר')),
      h('span', { class: `list-amount ${x.amount > 0 ? 'pos' : ''}` }, money(x.amount, { sign: x.amount > 0 }))));

  return [
    card(cardTitle('סיכום חודשי'),
      h('div', { class: 'stats' },
        h('div', { class: 'stat' }, h('span', { class: 'stat-label' }, 'חיובים קבועים'), h('span', { class: 'stat-value' }, money(r.totals.monthlyRecurring))),
        h('div', { class: 'stat' }, h('span', { class: 'stat-label' }, 'הכנסות קבועות'), h('span', { class: 'stat-value pos' }, money(r.totals.monthlyRecurringIncome))),
        h('div', { class: 'stat' }, h('span', { class: 'stat-label' }, 'תשלומים'), h('span', { class: 'stat-value' }, money(r.totals.installmentsMonthly)))),
      h('p', { class: 'muted small' }, 'חיובים דו-חודשיים מחושבים כחצי לחודש.')),
    income.length > 0 && card(cardTitle('הכנסות קבועות'), h('ul', { class: 'list' }, income.map(row))),
    expenses.length > 0 && card(cardTitle('חיובים קבועים'), h('ul', { class: 'list' }, expenses.map(row))),
    r.installments.length > 0 && card(cardTitle('עסקאות בתשלומים'),
      h('ul', { class: 'list' }, r.installments.map(i => h('li', { class: 'list-row installment' },
        h('span', { class: 'list-main' },
          h('span', {}, i.description),
          h('span', { class: 'muted small' }, `${i.accountName} · ${i.number} מתוך ${i.total} · ${money(i.payment)} לחודש`),
          h('span', { class: 'mini-progress', role: 'img', 'aria-label': `שולמו ${i.number} מתוך ${i.total}` },
            h('span', { style: { width: `${i.number / i.total * 100}%` } }))),
        h('span', { class: 'list-amount' }, h('span', {}, money(i.remainingAmount)), h('span', { class: 'muted small' }, `נשארו ${i.remainingCount}`)))))),
    inactive.length > 0 && card(h('details', { class: 'section' },
      h('summary', {}, `הופסקו או סומנו כלא קבועים (${inactive.length})`),
      h('ul', { class: 'list' }, inactive.map(row)))),
  ];
}

const priceUp = x => x.amount < 0 && x.previousAmount && Math.abs(x.lastAmount) > Math.abs(x.previousAmount) * 1.05;

function openItem(ctx, x) {
  const toggle = h('button', { type: 'button', class: x.status === 'paused' ? 'btn' : 'btn danger' },
    x.status === 'paused' ? 'החזרה לחיובים הקבועים' : 'זה לא חיוב קבוע');
  const sheet = openSheet(x.merchant, h('div', {},
    h('dl', { class: 'facts' },
      h('dt', {}, 'סכום אופייני'), h('dd', {}, money(x.amount, { decimals: true, sign: x.amount > 0 })),
      h('dt', {}, 'תדירות'), h('dd', {}, CADENCE[x.cadence] || x.cadence),
      h('dt', {}, 'חיוב אחרון'), h('dd', {}, `${shortDate(x.lastDate)} · ${money(x.lastAmount, { decimals: true, sign: x.lastAmount > 0 })}`),
      x.previousAmount != null && [h('dt', {}, 'חיוב קודם'), h('dd', {}, money(x.previousAmount, { decimals: true, sign: x.previousAmount > 0 }))],
      x.status === 'active' && [h('dt', {}, 'צפוי הבא'), h('dd', {}, shortDate(x.nextDate))],
      x.accountName && [h('dt', {}, 'חשבון'), h('dd', {}, accountLabel(x.accountName, x.accountMasked))],
      x.categoryName && [h('dt', {}, 'קטגוריה'), h('dd', {}, `${x.categoryIcon || ''} ${x.categoryName}`)],
      h('dt', {}, 'זוהה מתוך'), h('dd', {}, `${x.occurrences} חיובים`)),
    h('div', { class: 'stack' },
      h('button', { type: 'button', class: 'btn', onclick: () => { sheet.close(); ctx.navigate('transactions', { q: x.merchant }); } }, 'כל החיובים האלה'),
      toggle)));
  toggle.addEventListener('click', async () => {
    toggle.disabled = true;
    try {
      await api('recurring/dismiss', { method: 'POST', body: { id: x.id, dismissed: x.status !== 'paused' } });
      sheet.close();
      toast(x.status === 'paused' ? 'הוחזר לחיובים הקבועים' : 'הוסר מהחיובים הקבועים');
      ctx.refresh({ keepScroll: true });
    } catch (err) {
      toast(messageFor(err));
      toggle.disabled = false;
    }
  });
}
