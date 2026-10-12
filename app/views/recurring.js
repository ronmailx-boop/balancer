import { api, messageFor } from '../api.js';
import { h, card, cardTitle, money, shortDate, emptyState, openSheet, toast, accountLabel } from '../ui.js';
import { openFixedEditor } from './home.js';

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
  // What leaves every month: fixed charges plus the active installment payments
  const monthlyAll = Math.round((r.totals.monthlyRecurring + r.totals.installmentsMonthly) * 100) / 100;
  const row = x => h('li', {},
    h('button', { type: 'button', class: 'list-row list-button', onclick: () => openItem(ctx, x) },
      h('span', { class: 'list-icon', 'aria-hidden': 'true' }, x.categoryIcon || '🔁'),
      h('span', { class: 'list-main' },
        h('span', {}, x.merchant),
        h('span', { class: 'muted small' }, `${CADENCE[x.cadence] || x.cadence} · ${x.status === 'active' ? `הבא ${shortDate(x.nextDate)}` : x.status === 'paused' ? 'סומן כלא קבוע' : `אחרון ${shortDate(x.lastDate)}`}`),
        x.rolling && h('span', { class: x.rollingFixed ? 'muted small' : 'status-label small warning' },
          x.rollingFixed ? `חיוב קבוע · יתרה מתגלגלת ${money(-x.rollingBalance)}` : '⚠️ יתרה מתגלגלת. לחץ כדי להגדיר את החיוב הקבוע'),
        priceUp(x) && h('span', { class: 'status-label small warning' }, '⚠️ התייקר')),
      h('span', { class: `list-amount ${x.amount > 0 ? 'pos' : ''}` }, money(x.amount, { sign: x.amount > 0 }))));

  return [
    card(cardTitle('סיכום חודשי'),
      h('div', { class: 'stats' },
        h('div', { class: 'stat' }, h('span', { class: 'stat-label' }, 'חיובים קבועים'), h('span', { class: 'stat-value' }, money(r.totals.monthlyRecurring))),
        h('div', { class: 'stat' }, h('span', { class: 'stat-label' }, 'הכנסות קבועות'), h('span', { class: 'stat-value pos' }, money(r.totals.monthlyRecurringIncome))),
        h('div', { class: 'stat' }, h('span', { class: 'stat-label' }, 'תשלומים'), h('span', { class: 'stat-value' }, money(r.totals.installmentsMonthly)))),
      h('p', { class: 'muted small' }, 'חיובים דו-חודשיים מחושבים כחצי לחודש.')),
    income.length > 0 && card(cardTitle('הכנסות קבועות', h('span', { class: 'card-total pos' }, `${money(r.totals.monthlyRecurringIncome)} בחודש`)),
      h('ul', { class: 'list' }, income.map(row))),
    expenses.length > 0 && card(cardTitle('חיובים קבועים', h('span', { class: 'card-total' }, `${money(monthlyAll)} בחודש`)),
      r.totals.installmentsMonthly > 0 && h('p', { class: 'muted small' },
        `${money(r.totals.monthlyRecurring)} חיובים קבועים + ${money(r.totals.installmentsMonthly)} עסקאות בתשלומים`),
      h('ul', { class: 'list' }, expenses.map(row))),
    r.installments.length > 0 && card(cardTitle('עסקאות בתשלומים', h('span', { class: 'card-total' }, `${money(r.totals.installmentsMonthly)} בחודש`)),
      h('ul', { class: 'list' }, r.installments.map(i => installmentRow(ctx, i)))),
    r.installmentsDone?.length > 0 && card(h('details', { class: 'section' },
      h('summary', {}, `תשלומים שהסתיימו או נפרעו (${r.installmentsDone.length})`),
      h('ul', { class: 'list' }, r.installmentsDone.map(i => installmentRow(ctx, i))))),
    inactive.length > 0 && card(h('details', { class: 'section' },
      h('summary', {}, `הופסקו או סומנו כלא קבועים (${inactive.length})`),
      h('ul', { class: 'list' }, inactive.map(row)))),
  ];
}

function installmentRow(ctx, i) {
  return h('li', {},
    h('button', { type: 'button', class: 'list-row list-button installment', onclick: () => openInstallment(ctx, i) },
      h('span', { class: 'list-main' },
        h('span', {}, i.description),
        h('span', { class: 'muted small' }, `${i.accountName} · ${i.number} מתוך ${i.total} · ${money(i.payment)} לחודש`),
        i.paidOff && h('span', { class: 'muted small' }, 'סומן כנפרע'),
        h('span', { class: 'mini-progress', role: 'img', 'aria-label': `שולמו ${i.number} מתוך ${i.total}` },
          h('span', { style: { width: `${i.paidOff ? 100 : i.number / i.total * 100}%` } }))),
      h('span', { class: 'list-amount' }, h('span', {}, money(i.paidOff ? 0 : i.remainingAmount)), h('span', { class: 'muted small' }, `נשארו ${i.paidOff ? 0 : i.remainingCount}`))));
}

function openInstallment(ctx, i) {
  const toggle = h('button', { type: 'button', class: i.paidOff ? 'btn' : 'btn danger' },
    i.paidOff ? 'החזרה לתשלומים הפעילים' : 'פרעתי את כל הסכום (הסרה מהרשימה)');
  const sheet = openSheet(i.description, h('div', {},
    h('dl', { class: 'facts' },
      h('dt', {}, 'עסקה מקורית'), h('dd', {}, money(i.fullAmount, { decimals: true })),
      h('dt', {}, 'תשלום חודשי'), h('dd', {}, money(i.payment, { decimals: true })),
      h('dt', {}, 'שולמו'), h('dd', {}, `${i.number} מתוך ${i.total}`),
      h('dt', {}, 'נשאר לשלם'), h('dd', {}, i.paidOff ? 'נפרע' : `${money(i.remainingAmount, { decimals: true })} (${i.remainingCount} תשלומים)`),
      h('dt', {}, 'כרטיס'), h('dd', {}, i.accountName),
      h('dt', {}, 'תשלום אחרון שנקלט'), h('dd', {}, shortDate(i.lastDate))),
    i.remainingCount > 0 && h('div', { class: 'stack' },
      h('p', { class: 'muted small' }, i.paidOff
        ? 'התשלומים האלה סומנו כנפרעו ולא נספרים בסיכומים.'
        : 'אם פרעת את היתרה מראש, אפשר להסיר את העסקה מהתשלומים הפעילים ומהסיכום החודשי.'),
      toggle)));
  toggle.addEventListener('click', async () => {
    toggle.disabled = true;
    try {
      await api('installments/hide', { method: 'POST', body: { id: i.id, hidden: !i.paidOff } });
      sheet.close();
      toast(i.paidOff ? 'הוחזר לתשלומים הפעילים' : 'סומן כנפרע');
      ctx.refresh({ keepScroll: true });
    } catch (err) {
      toast(messageFor(err));
      toggle.disabled = false;
    }
  });
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
      h('dt', {}, 'זוהה מתוך'), h('dd', {}, `${x.occurrences} חיובים`),
      x.rolling && [h('dt', {}, 'יתרה מתגלגלת'), h('dd', {}, money(-x.rollingBalance, { decimals: true }))],
      x.rolling && [h('dt', {}, 'חיוב קבוע'), h('dd', {}, x.rollingFixed ? money(x.rollingFixed) : 'לא הוגדר')]),
    x.rolling && h('button', { type: 'button', class: 'btn primary', onclick: () => {
      sheet.close();
      openFixedEditor(ctx, { account: { id: x.accountId, name: x.accountName, masked: x.accountMasked }, fixed: x.rollingFixed });
    } }, x.rollingFixed ? 'שינוי החיוב הקבוע' : 'הגדרת החיוב הקבוע'),
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
