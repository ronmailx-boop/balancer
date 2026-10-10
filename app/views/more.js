import { h, card } from '../ui.js';

export const title = 'עוד';

const LINKS = [
  ['trends', '📈', 'מגמות ותזרים', 'השוואה בין חודשים, ממוצעים ותחזית לסוף החודש'],
  ['recurring', '🔁', 'הוראות קבע ותשלומים', 'מנויים, חיובים קבועים ועסקאות בתשלומים'],
  ['accounts', '🏦', 'חשבונות וחיבורים', 'בנקים וכרטיסי אשראי'],
  ['settings', '⚙️', 'הגדרות', 'סיסמה, נעילה, מצב הדגמה, ייצוא'],
];

export async function render(ctx) {
  return card(h('ul', { class: 'menu' }, LINKS.map(([route, icon, label, sub]) => h('li', {},
    h('button', { type: 'button', class: 'menu-row', onclick: () => ctx.navigate(route) },
      h('span', { class: 'menu-icon', 'aria-hidden': 'true' }, icon),
      h('span', { class: 'menu-main' }, h('span', {}, label), h('span', { class: 'muted small' }, sub)),
      h('span', { class: 'chev', 'aria-hidden': 'true' }, '›'))))));
}
