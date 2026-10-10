import { api } from '../api.js';
import { h, card, cardTitle, money, monthLabel, relativeDays, progress, budgetStatus, emptyState, shortDate } from '../ui.js';
import { rankedBars } from '../charts.js';

export const title = 'בית';
export const usesMonth = true;

export async function render(ctx) {
  const o = await api(`overview?month=${ctx.month}`);
  ctx.setDemo(o.demo);
  if (!o.hasData) {
    return emptyState('🏦', 'אין עדיין נתונים',
      'חיבור לבנק ולכרטיסי האשראי יתווסף בשלב הבא. בינתיים אפשר לראות איך האפליקציה נראית עם נתונים לדוגמה.',
      h('button', { class: 'btn primary', type: 'button', onclick: async () => { await api('settings/demo', { method: 'POST', body: { enabled: true } }); ctx.refresh(); } }, 'הפעלת מצב הדגמה'));
  }

  const net = o.net;
  const remaining = o.budget?.remaining;
  const status = o.budget ? budgetStatus(o.budget.spent, o.budget.planned) : null;

  return [
    h('section', { class: 'hero' },
      h('p', { class: 'hero-label' }, 'יתרה בעו"ש'),
      h('p', { class: 'hero-value' }, money(o.balances.total)),
      h('p', { class: 'hero-sub' }, `עודכן ${o.balances.accounts[0]?.lastSyncAt ? new Date(o.balances.accounts[0].lastSyncAt).toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' }) : '—'}`)),

    card(cardTitle(monthLabel(o.month)),
      h('div', { class: 'stats' },
        stat('הכנסות', money(o.income), 'pos'),
        stat('הוצאות', money(o.expenses)),
        stat('נשאר', money(net, { sign: true }), net >= 0 ? 'pos' : 'neg')),
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

    o.upcomingCharges.length > 0 && card(cardTitle('חיובי אשראי קרובים'),
      h('ul', { class: 'list' }, o.upcomingCharges.map(c => h('li', { class: 'list-row' },
        h('span', { class: 'list-icon', 'aria-hidden': 'true' }, '💳'),
        h('span', { class: 'list-main' }, h('span', {}, `${c.name} ••${c.masked}`), h('span', { class: 'muted small' }, `יורד מהעו"ש ${relativeDays(c.date, o.today)} (${shortDate(c.date)})`)),
        h('span', { class: 'list-amount' }, money(c.amount)))))),

    card(cardTitle('החשבונות שלי', h('button', { class: 'link', type: 'button', onclick: () => ctx.navigate('accounts') }, 'ניהול')),
      h('div', { class: 'account-strip' }, o.balances.accounts.map(a => h('div', { class: `account-card ${a.type}` },
        h('span', { class: 'account-name' }, a.name),
        h('span', { class: 'account-num' }, `••${a.masked}`),
        h('span', { class: 'account-balance' }, a.type === 'card' ? money(-a.balance) : money(a.balance)),
        h('span', { class: 'muted small' }, a.type === 'card' ? 'חיוב הבא' : 'יתרה'))))),

    o.topCategories.length > 0 && card(cardTitle('הוצאות מובילות', h('button', { class: 'link', type: 'button', onclick: () => ctx.navigate('month') }, 'לכל הקטגוריות')),
      rankedBars(o.topCategories, { onSelect: c => ctx.navigate('transactions', { category: c.id ?? 'none' }) })),
  ];
}

function stat(label, value, cls = '') {
  return h('div', { class: 'stat' }, h('span', { class: 'stat-label' }, label), h('span', { class: `stat-value ${cls}` }, value));
}

export function statusIcon(level) {
  return { critical: '⛔', warning: '⚠️', good: '✅' }[level] || 'ℹ️';
}
