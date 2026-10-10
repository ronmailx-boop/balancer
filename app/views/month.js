import { api } from '../api.js';
import { h, card, cardTitle, money, progress, budgetStatus, emptyState } from '../ui.js';
import { rankedBars } from '../charts.js';
import { statusIcon } from './home.js';

export const title = 'חודשי';
export const usesMonth = true;

export async function render(ctx) {
  const m = await api(`month?month=${ctx.month}`);
  if (!m.categories.length && !m.income) return emptyState('📅', 'אין תנועות בחודש הזה', 'אפשר להחליק או להשתמש בחצים כדי לעבור לחודש אחר.');
  const diff = m.expenses - m.previous.expenses;
  const budgeted = m.categories.filter(c => c.budget != null);

  return [
    card(cardTitle('הכנסות מול הוצאות'),
      h('div', { class: 'stats' },
        h('div', { class: 'stat' }, h('span', { class: 'stat-label' }, 'הכנסות'), h('span', { class: 'stat-value pos' }, money(m.income))),
        h('div', { class: 'stat' }, h('span', { class: 'stat-label' }, 'הוצאות'), h('span', { class: 'stat-value' }, money(m.expenses))),
        h('div', { class: 'stat' }, h('span', { class: 'stat-label' }, 'נטו'), h('span', { class: `stat-value ${m.net >= 0 ? 'pos' : 'neg'}` }, money(m.net, { sign: true })))),
      m.previous.expenses > 0 && h('p', { class: 'muted small compare' },
        diff > 0 ? `הוצאת ${money(diff)} יותר מהחודש הקודם` : `הוצאת ${money(-diff)} פחות מהחודש הקודם`)),

    m.categories.length > 0 && card(cardTitle('הוצאות לפי קטגוריה'),
      rankedBars(m.categories, { max: 12, onSelect: c => ctx.navigate('transactions', { category: c.id ?? 'none' }) })),

    budgeted.length > 0 && card(cardTitle('תקציב מול ביצוע', h('button', { class: 'link', type: 'button', onclick: () => ctx.navigate('budget') }, 'עריכה')),
      h('ul', { class: 'budget-list' }, budgeted.map(c => {
        const st = budgetStatus(c.amount, c.budget, c.fixed);
        return h('li', {},
          h('div', { class: 'budget-row-top' },
            h('span', {}, `${c.icon} ${c.name}`),
            h('span', { class: 'muted small' }, `${money(c.amount)} / ${money(c.budget)}`)),
          progress(c.amount, c.budget, c.fixed),
          st.level !== 'good' && h('span', { class: `status-label small ${st.level}` }, statusIcon(st.level), ' ', st.label));
      }))),
  ];
}
