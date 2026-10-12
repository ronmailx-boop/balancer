import { api, messageFor } from '../api.js';
import { h, card, cardTitle, money, monthLabel, relativeDays, progress, budgetStatus, emptyState, shortDate, cycleRange, accountLabel, openSheet, toast } from '../ui.js';
import { openBalancePicker } from './prefs.js';
import { openFlow } from './flow.js';
import { txRow, openDetail } from './transactions.js';
import { rankedBars } from '../charts.js';

export const title = 'בית';
export const usesMonth = true;

export async function render(ctx) {
  const o = await api(`overview?month=${ctx.month}`);
  ctx.setDemo(o.demo);
  if (o.autoSync) {
    toast('סנכרון אוטומטי התחיל ברקע');
    ctx.watchSync();
  }
  if (!o.hasData) {
    return emptyState('🏦', 'אין עדיין נתונים',
      'מחברים את הבנק וכרטיסי האשראי, או מסתכלים קודם איך זה נראה עם נתונים לדוגמה.',
      h('div', { class: 'stack' },
        h('button', { class: 'btn primary', type: 'button', onclick: () => ctx.navigate('accounts') }, 'חיבור בנק או כרטיס אשראי'),
        h('button', { class: 'btn', type: 'button', onclick: async () => { await api('settings/demo', { method: 'POST', body: { enabled: true } }); ctx.refresh(); } }, 'הצצה עם נתונים לדוגמה')));
  }

  const net = o.net;
  const bankAccounts = o.balances.accounts.filter(a => a.type !== 'card');
  const bankCount = bankAccounts.length;
  const included = bankAccounts.filter(a => a.inBalance);
  const range = cycleRange(o.month, ctx.cycleDay);
  const remaining = o.budget?.remaining;
  const status = o.budget ? budgetStatus(o.budget.spent, o.budget.planned) : null;

  return [
    h('section', { class: 'hero' },
      h('p', { class: 'hero-label' }, o.balances.total < 0 ? 'יתרה בעו"ש · יתרת חובה' : 'יתרה בעו"ש'),
      h('p', { class: `hero-value ${o.balances.total < 0 ? 'overdrawn' : ''}` }, money(o.balances.total, { sign: o.balances.total < 0 })),
      h('p', { class: 'hero-sub' }, updatedLabel(o.balances.accounts)),
      bankCount > 1 && h('button', { type: 'button', class: 'hero-link', onclick: () => openBalancePicker(() => ctx.refresh({ keepScroll: true })) },
        o.balances.partial ? `לפי ${included.length} מתוך ${bankCount} חשבונות · שינוי` : `כל ${bankCount} החשבונות · בחירה`)),

    card(cardTitle(monthLabel(o.month), range && h('span', { class: 'muted small' }, range)),
      h('div', { class: 'stats' },
        stat('הכנסות', money(o.income), 'pos', () => openFlow(ctx, o.month, 'income')),
        stat('הוצאות', money(o.expenses), '', () => openFlow(ctx, o.month, 'expense')),
        stat('נשאר', money(net, { sign: true }), net >= 0 ? 'pos' : 'neg', () => openFlow(ctx, o.month, 'net', o.budget))),
      o.budget && h('div', { class: 'budget-line' },
        h('div', { class: 'budget-line-top' },
          h('span', {}, 'תקציב החודש'),
          h('span', { class: `status-label ${status.level}` }, statusIcon(status.level), ' ', remaining >= 0 ? `נשארו ${money(remaining)}` : `חריגה של ${money(-remaining)}`)),
        progress(o.budget.spent, o.budget.planned),
        h('p', { class: 'muted small' }, `${money(o.budget.spent)} מתוך ${money(o.budget.planned)}`))),

    o.alerts.length > 0 && card(cardTitle('התראות'),
      h('ul', { class: 'alerts' }, o.alerts.map(a => h('li', { class: `alert ${a.level}` },
        h('span', { class: 'alert-icon', 'aria-hidden': 'true' }, statusIcon(a.level)),
        h('span', {}, a.text),
        a.categoryId && h('button', { class: 'link', type: 'button', onclick: () => ctx.navigate('transactions', { category: a.categoryId }) }, 'פירוט'))))),

    o.insights?.length > 0 && card(cardTitle('תובנות'),
      h('ul', { class: 'insights' }, o.insights.map(i => h('li', { class: `insight ${i.level}` },
        h('span', { class: 'insight-icon', 'aria-hidden': 'true' }, i.icon),
        h('span', {}, i.text),
        (i.categoryId || i.link) && h('button', { class: 'link', type: 'button', onclick: () => (i.link ? ctx.navigate(i.link) : ctx.navigate('transactions', { category: i.categoryId })) }, 'פירוט'))))),

    o.upcomingCharges.length > 0 && card(cardTitle('חיובי אשראי קרובים'),
      h('ul', { class: 'list' }, o.upcomingCharges.map(c => h('li', {},
        h('button', { type: 'button', class: 'list-row list-button', onclick: () => openCharge(ctx, c) },
          h('span', { class: 'list-icon', 'aria-hidden': 'true' }, '💳'),
          h('span', { class: 'list-main' }, h('span', {}, accountLabel(c.name, c.masked)), h('span', { class: 'muted small' }, `יורד מהעו"ש ${relativeDays(c.date, o.today)} (${shortDate(c.date)})`),
            c.rolled > 0 && h('span', { class: 'muted small' }, `חיוב קבוע · ${money(c.rolled)} עובר לאשראי מתגלגל`),
            c.rollingHint && h('span', { class: 'status-label small warning' }, '⚠️ אשראי מתגלגל: לחץ כדי להגדיר את החיוב הקבוע')),
          h('span', { class: 'list-amount' }, money(c.amount)),
          h('span', { class: 'list-chevron', 'aria-hidden': 'true' }, '‹')))))),

    card(cardTitle('החשבונות שלי', h('button', { class: 'link', type: 'button', onclick: () => ctx.navigate('accounts') }, 'ניהול')),
      h('div', { class: 'account-strip' }, o.balances.accounts.map(a => h('div', { class: `account-card ${a.type}` },
        h('span', { class: 'account-name' }, a.name),
        h('span', { class: 'account-num' }, `••${a.masked}`),
        h('span', { class: `account-balance ${a.type !== 'card' && a.balance < 0 ? 'neg' : ''}` }, a.type === 'card' ? money(a.nextDebit ?? -a.balance) : money(a.balance, { sign: a.balance < 0 })),
        h('span', { class: 'muted small' }, a.type === 'card' ? (a.nextDebit != null ? 'חיוב קבוע הבא' : 'חיוב הבא') : 'יתרה'))))),

    o.topCategories.length > 0 && card(cardTitle('הוצאות מובילות', h('button', { class: 'link', type: 'button', onclick: () => ctx.navigate('month') }, 'לכל הקטגוריות')),
      rankedBars(o.topCategories, { onSelect: c => ctx.navigate('transactions', { category: c.id ?? 'none' }) })),
  ];
}

// The transactions that make up one card bill
async function openCharge(ctx, c) {
  let res;
  let cats;
  try {
    [res, cats] = await Promise.all([api(`card-charge?account=${encodeURIComponent(c.accountId)}&date=${c.date}`), api('categories')]);
  } catch (err) {
    return toast(messageFor(err));
  }
  const line = (label, value, cls = '') => h('div', { class: 'flow-line' }, h('span', {}, label), h('span', { class: cls }, value));
  const fixedText = !res.fixed && res.rollingHint
    ? 'בחיוב הזה יש יתרת אשראי מתגלגל, אבל עוד לא ידוע כמה יורד מהעו"ש כל חודש. לחץ "שינוי" והזן את החיוב הקבוע.'
    : res.fixed
    ? `חיוב חודשי קבוע (אשראי מתגלגל): ${money(res.fixed)}${res.fixedSource === 'auto' ? ' · זוהה אוטומטית' : ''}`
    : 'אין חיוב חודשי קבוע בכרטיס הזה (כל החיוב יורד מהעו"ש).';
  const sheet = openSheet(`${accountLabel(res.account.name, res.account.masked)} · ${shortDate(res.date)}`, h('div', { class: 'charge-detail' },
    res.rolled > 0
      ? h('div', { class: 'flow-calc' },
        line('סה"כ החיוב בכרטיס', money(res.amount, { decimals: true })),
        line(`יורד מהעו"ש ב-${shortDate(res.date)}`, money(res.debit, { decimals: true })),
        h('div', { class: 'flow-total' }, line('עובר לאשראי המתגלגל', money(res.rolled, { decimals: true }), 'neg')))
      : h('div', { class: 'charge-head' },
        h('span', { class: 'tx-detail-amount' }, money(res.amount, { decimals: true })),
        h('span', { class: 'muted small' }, `${res.items.length} עסקאות · יורד מהעו"ש ב-${shortDate(res.date)}`)),
    h('div', { class: 'fixed-row' },
      h('span', { class: 'muted small' }, fixedText),
      h('button', { type: 'button', class: 'link', onclick: () => { sheet.close(); openFixedEditor(ctx, res); } }, 'שינוי')),
    res.items.length
      ? h('ul', { class: 'tx-list' }, res.items.map(t => txRow(t, () => { sheet.close(); openDetail(ctx, t, cats); })))
      : h('p', { class: 'muted' }, 'לא נמצא פירוט לחיוב הזה.')));
}

// Fixed monthly payment of a card with rolling credit (or none, or back to automatic detection)
function openFixedEditor(ctx, res) {
  const input = h('input', { id: 'fixed-amount', type: 'number', inputmode: 'decimal', min: 1, step: '1', value: res.fixed || '', placeholder: 'למשל 2000' });
  const error = h('p', { class: 'error', role: 'alert' });
  const send = async (amount, msg) => {
    try {
      await api('card-fixed', { method: 'POST', body: { accountId: res.account.id, amount } });
      sheet.close();
      toast(msg);
      ctx.refresh({ keepScroll: true });
    } catch (err) {
      error.textContent = messageFor(err);
    }
  };
  const form = h('form', { novalidate: true },
    h('p', { class: 'muted small' }, 'בכרטיס עם אשראי מתגלגל יורד מהעו"ש כל חודש סכום קבוע, והשאר עובר לחודש הבא. הסכום הזה ישמש בחיובים הקרובים, בתחזית ובהתראות.'),
    h('label', { for: 'fixed-amount' }, 'החיוב החודשי הקבוע (₪)'), input,
    error,
    h('button', { type: 'submit', class: 'btn primary' }, 'שמירה'),
    h('button', { type: 'button', class: 'btn', onclick: () => send(0, 'סומן: אין אשראי מתגלגל בכרטיס') }, 'אין אשראי מתגלגל בכרטיס הזה'),
    h('button', { type: 'button', class: 'link', onclick: () => send(null, 'חזרה לזיהוי אוטומטי') }, 'זיהוי אוטומטי לפי חיובי העו"ש'));
  form.addEventListener('submit', e => {
    e.preventDefault();
    const n = Number(input.value);
    if (!(n > 0)) return (error.textContent = 'יש להזין סכום חיובי.');
    send(n, 'החיוב הקבוע נשמר');
  });
  const sheet = openSheet(`חיוב קבוע · ${accountLabel(res.account.name, res.account.masked)}`, form);
}

// "עודכן 10.10 בשעה 22:03" (the latest sync of any account)
function updatedLabel(accounts) {
  const last = accounts.map(a => a.lastSyncAt).filter(Boolean).sort().pop();
  if (!last) return 'עוד לא סונכרן';
  const d = new Date(last);
  const date = d.toLocaleDateString('he-IL', { day: 'numeric', month: 'numeric' });
  const time = d.toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' });
  return `עודכן ${date} בשעה ${time}`;
}

export function stat(label, value, cls = '', onclick) {
  return h(onclick ? 'button' : 'div', { class: 'stat', ...(onclick ? { type: 'button', onclick, 'aria-label': `${label}: פירוט` } : {}) },
    h('span', { class: 'stat-label' }, label, onclick && h('span', { class: 'stat-more', 'aria-hidden': 'true' }, ' ‹')),
    h('span', { class: `stat-value ${cls}` }, value));
}

export function statusIcon(level) {
  return { critical: '⛔', warning: '⚠️', good: '✅' }[level] || 'ℹ️';
}
