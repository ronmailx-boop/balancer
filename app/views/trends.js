import { api } from '../api.js';
import { h, card, cardTitle, money, shortDate } from '../ui.js';
import { incomeExpenseBars, sparkline } from '../charts.js';

export const title = 'מגמות ותזרים';
export const back = 'more';

export async function render(ctx) {
  const months = ctx.params.months === '12' ? 12 : 6;
  const t = await api(`trends?months=${months}`);
  const toggle = h('div', { class: 'segmented', role: 'group', 'aria-label': 'טווח' },
    [6, 12].map(n => h('button', { type: 'button', 'aria-pressed': String(n === months), onclick: () => ctx.navigate('trends', { months: String(n) }, { replace: true }) }, `${n} חודשים`)));
  const complete = t.months.slice(0, -1);
  const avgExp = complete.length ? complete.reduce((s, m) => s + m.expenses, 0) / complete.length : 0;
  const avgInc = complete.length ? complete.reduce((s, m) => s + m.income, 0) / complete.length : 0;
  const p = t.projection;

  return [
    toggle,
    card(cardTitle('תחזית לסוף החודש'),
      h('div', { class: 'stats' },
        h('div', { class: 'stat' }, h('span', { class: 'stat-label' }, 'יתרה היום'), h('span', { class: 'stat-value' }, money(p.today))),
        h('div', { class: 'stat' }, h('span', { class: 'stat-label' }, 'צפי לסוף החודש'), h('span', { class: `stat-value ${p.projected >= 0 ? 'pos' : 'neg'}` }, money(p.projected)))),
      p.items.length > 0 && h('details', { class: 'table-view' }, h('summary', {}, `צפויים עד סוף החודש (${p.items.length})`),
        h('ul', { class: 'list' }, p.items.map(i => h('li', { class: 'list-row' },
          h('span', { class: 'list-main' }, h('span', {}, i.label), h('span', { class: 'muted small' }, shortDate(i.date))),
          h('span', { class: `list-amount ${i.amount > 0 ? 'pos' : ''}` }, money(i.amount, { sign: true }))))))),
    card(cardTitle('הכנסות מול הוצאות'),
      incomeExpenseBars(t.months),
      h('p', { class: 'muted small' }, `ממוצע חודשי (חודשים מלאים): הכנסות ${money(avgInc)} · הוצאות ${money(avgExp)}`)),
    card(cardTitle('ממוצע חודשי לפי קטגוריה'),
      h('ul', { class: 'list' }, t.averages.map(a => h('li', { class: 'list-row' },
        h('span', { class: 'list-icon', 'aria-hidden': 'true' }, a.icon || '❔'),
        h('span', { class: 'list-main' }, h('span', {}, a.name)),
        sparkline(a.months),
        h('span', { class: 'list-amount' }, money(a.average)))))),
  ];
}
