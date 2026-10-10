import { api, messageFor } from '../api.js';
import { h, card, cardTitle, money, progress, budgetStatus, toast } from '../ui.js';
import { statusIcon } from './home.js';

export const title = 'תקציב';
export const usesMonth = true;

export async function render(ctx) {
  const b = await api(`budget?month=${ctx.month}`);
  const inputs = new Map();
  const error = h('p', { class: 'error', role: 'alert' });

  const row = item => {
    const input = h('input', {
      type: 'number', inputmode: 'numeric', min: 0, step: 50, class: 'budget-input',
      value: item.planned ?? '', placeholder: item.previousPlanned ? String(item.previousPlanned) : '—',
      'aria-label': `תקציב ל${item.name}`,
    });
    inputs.set(item.id, input);
    const st = budgetStatus(item.spent, item.planned, item.fixed);
    return h('li', { class: 'budget-edit' },
      h('div', { class: 'budget-edit-top' },
        h('span', { class: 'budget-edit-name' }, `${item.icon} ${item.name}`),
        input),
      h('div', { class: 'budget-edit-bottom' },
        h('span', { class: 'muted small' }, `בוצע ${money(item.spent)}`),
        item.planned && st.level !== 'good' && h('span', { class: `status-label small ${st.level}` }, statusIcon(st.level), ' ', st.label)),
      item.planned ? progress(item.spent, item.planned, item.fixed) : null);
  };

  const fixed = b.items.filter(i => i.fixed);
  const variable = b.items.filter(i => !i.fixed);
  const form = h('form', { novalidate: true },
    card(cardTitle('הוצאות קבועות', h('span', { class: 'muted small' }, `${money(b.totals.fixed.spent)} / ${money(b.totals.fixed.planned)}`)),
      h('ul', { class: 'budget-edit-list' }, fixed.map(row))),
    card(cardTitle('הוצאות משתנות', h('span', { class: 'muted small' }, `${money(b.totals.variable.spent)} / ${money(b.totals.variable.planned)}`)),
      h('ul', { class: 'budget-edit-list' }, variable.map(row))),
    error,
    h('div', { class: 'sticky-actions' }, h('button', { type: 'submit', class: 'btn primary' }, 'שמירת תקציב')));

  form.addEventListener('submit', async e => {
    e.preventDefault();
    error.textContent = '';
    try {
      await api('budget', { method: 'POST', body: { month: ctx.month, items: [...inputs].map(([categoryId, el]) => ({ categoryId, amount: el.value === '' ? null : Number(el.value) })) } });
      toast('התקציב נשמר');
      ctx.refresh({ keepScroll: true });
    } catch (err) {
      error.textContent = messageFor(err);
    }
  });

  return [
    card(cardTitle('סיכום'),
      h('div', { class: 'stats' },
        h('div', { class: 'stat' }, h('span', { class: 'stat-label' }, 'מתוכנן'), h('span', { class: 'stat-value' }, money(b.totals.planned))),
        h('div', { class: 'stat' }, h('span', { class: 'stat-label' }, 'בוצע'), h('span', { class: 'stat-value' }, money(b.totals.spent))),
        h('div', { class: 'stat' }, h('span', { class: 'stat-label' }, 'נשאר'), h('span', { class: `stat-value ${b.totals.planned - b.totals.spent >= 0 ? 'pos' : 'neg'}` }, money(b.totals.planned - b.totals.spent, { sign: true })))),
      b.hasPrevious && h('button', {
        type: 'button', class: 'btn', onclick: async () => {
          await api('budget/copy', { method: 'POST', body: { month: ctx.month } });
          toast('התקציב הועתק מהחודש הקודם');
          ctx.refresh();
        },
      }, 'העתקה מהחודש הקודם')),
    form,
  ];
}
