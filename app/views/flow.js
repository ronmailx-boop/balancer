// Tap on הכנסות / הוצאות / נשאר: what makes up the number.
import { api, messageFor } from '../api.js';
import { h, money, monthLabel, shortDate, openSheet, toast, accountLabel } from '../ui.js';
import { txRow, openDetail } from './transactions.js';

const TITLES = { income: 'הכנסות', expense: 'הוצאות', net: 'נשאר' };

export async function openFlow(ctx, month, kind, budget) {
  let f;
  try {
    f = await api(`month/flow?month=${month}`);
  } catch (err) {
    return toast(messageFor(err));
  }
  const title = `${TITLES[kind]} · ${monthLabel(month)}`;
  const close = () => sheet.close();
  const sheet = openSheet(title, kind === 'net' ? netView(f, budget, ctx, close) : sideView(f[kind], kind, ctx, close));
}

function sideView(side, kind, ctx, close) {
  if (!side.items.length) return h('p', { class: 'muted' }, kind === 'income' ? 'אין הכנסות בחודש הזה.' : 'אין הוצאות בחודש הזה.');
  const cats = h('ul', { class: 'list' }, side.categories.map(c => h('li', {},
    h('button', { type: 'button', class: 'list-row list-button', onclick: () => { close(); ctx.navigate('transactions', { category: c.id ?? 'none' }); } },
      h('span', { class: 'list-icon', 'aria-hidden': 'true' }, c.icon),
      h('span', { class: 'list-main' }, h('span', {}, c.name), h('span', { class: 'muted small' }, `${c.count} תנועות`)),
      h('span', { class: `list-amount ${kind === 'income' ? 'pos' : ''}` }, money(c.amount)),
      h('span', { class: 'list-chevron', 'aria-hidden': 'true' }, '‹')))));
  const items = h('ul', { class: 'tx-list' }, side.items.map(t => txRow(
    { ...t, amount: kind === 'income' ? t.amount : -t.amount, recurring: false, split: false },
    async () => {
      try {
        const [full, cats] = await Promise.all([api(`transaction?id=${encodeURIComponent(t.id)}`), api('categories')]);
        close();
        openDetail(ctx, full, cats);
      } catch (err) {
        toast(messageFor(err));
      }
    })));
  return h('div', { class: 'flow' },
    h('div', { class: 'charge-head' },
      h('span', { class: `tx-detail-amount ${kind === 'income' ? 'pos' : ''}` }, money(side.total, { decimals: true })),
      h('span', { class: 'muted small' }, `${side.items.length} תנועות`)),
    h('h3', { class: 'field-title' }, 'לפי קטגוריה'),
    cats,
    h('h3', { class: 'field-title' }, 'כל התנועות'),
    items);
}

function netView(f, budget, ctx, close) {
  const net = Math.round((f.income.total - f.expense.total) * 100) / 100;
  const { transfers, excluded } = f.notCounted;
  const line = (label, value, cls = '') => h('div', { class: 'flow-line' }, h('span', {}, label), h('span', { class: cls }, value));
  return h('div', { class: 'flow' },
    h('div', { class: 'flow-calc' },
      line('הכנסות', money(f.income.total), 'pos'),
      line('פחות הוצאות', money(-f.expense.total)),
      h('div', { class: 'flow-total' }, line('נשאר', money(net, { sign: true }), net >= 0 ? 'pos' : 'neg'))),
    h('p', { class: 'muted small' }, `החישוב כולל את כל התנועות מ-${shortDate(f.range[0])} עד יום לפני ${shortDate(f.range[1])}: עסקאות בכרטיסי האשראי לפי תאריך הקנייה (תשלומים לפי תאריך החיוב), ותנועות בעו"ש.`),
    h('h3', { class: 'field-title' }, 'מה לא נספר'),
    h('ul', { class: 'flow-notes' },
      h('li', {}, transfers.count
        ? `${transfers.count} חיובי כרטיס אשראי והעברות בין חשבונות (${money(transfers.amount)}). הם לא נספרים, כי הקניות עצמן כבר נספרות מהכרטיס, וכך אותו כסף לא נספר פעמיים.`
        : 'אין החודש חיובי כרטיס אשראי או העברות בין חשבונות.'),
      excluded.count > 0 && h('li', {}, `${excluded.count} עסקאות שהחרגת מהסיכומים (${money(excluded.amount)}).`)),
    budget && [
      h('h3', { class: 'field-title' }, 'ומה עם "תקציב החודש"?'),
      h('p', { class: 'muted small' }, `"נשאר" כאן הוא הכנסות פחות הוצאות. "תקציב החודש" הוא חישוב נפרד: הוא סופר רק קטגוריות שקבעת להן תקציב. תכננת ${money(budget.planned)}, הוצאת בהן ${money(budget.spent)}, ולכן נשארו ${money(budget.remaining)}. הוצאות בקטגוריות בלי תקציב לא נכללות שם.`),
      h('button', { type: 'button', class: 'btn', onclick: () => { close(); ctx.navigate('budget'); } }, '🎯 לעריכת התקציב'),
    ]);
}
