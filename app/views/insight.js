// "How was this calculated": the numbers behind an insight on the home screen, step by step
import { h, money, monthLabel, shortDate, openSheet } from '../ui.js';
import { openFlow } from './flow.js';

const step = (n, title, ...body) => h('li', { class: 'calc-step' },
  h('span', { class: 'calc-num', 'aria-hidden': 'true' }, String(n)),
  h('div', { class: 'calc-body' }, h('strong', {}, title), ...body));

// Arithmetic reads left to right, also inside Hebrew text
const formula = (...parts) => h('p', { class: 'calc-formula', dir: 'ltr' }, ...parts);

const monthsList = months => h('ul', { class: 'calc-months' }, months.map(m =>
  h('li', {}, h('span', {}, monthLabel(m.month)), h('span', {}, money(m.amount)))));

const avgFormula = (months, average) => formula(
  months.length > 1 ? `(${months.map(m => money(m.amount)).join(' + ')}) ÷ ${months.length} = ` : '',
  h('b', {}, money(average)));

const diffLine = (diff, what) => h('p', { class: `calc-result ${diff > 0 ? 'up' : 'down'}` },
  `${money(Math.abs(diff))} ${diff > 0 ? 'יותר' : 'פחות'} ${what}`);

export function openInsight(ctx, i) {
  const e = i.explain;
  if (e.kind === 'pace') return pace(ctx, i, e);
  if (e.kind === 'category') return category(ctx, i, e);
  if (e.kind === 'recurring') return recurring(ctx, i, e);
}

function pace(ctx, i, e) {
  const n = e.months.length;
  const top = [...e.categories].sort((a, b) => b.amount - a.amount).slice(0, 8);
  const sheet = openSheet('איך זה חושב', h('div', { class: 'calc' },
    h('p', { class: 'calc-lead' }, i.text),
    h('ol', { class: 'calc-steps' },
      step(1, 'כמה הוצאת עד היום',
        h('p', {}, `מתחילת חודש התקציב (${shortDate(e.from)}) ועד היום (${shortDate(e.today)}) הוצאת על הוצאות משתנות `, h('b', {}, money(e.variableNow)), '.'),
        h('p', { class: 'muted small' }, `עברו ${e.elapsedDays} מתוך ${e.spanDays} הימים של החודש.`)),
      step(2, 'אם תמשיך באותו קצב',
        formula(`${money(e.variableNow)} ÷ ${e.elapsedDays} × ${e.spanDays} = `, h('b', {}, money(e.projected))),
        h('p', { class: 'muted small' }, `מה שהוצאת עד היום, חלקי ${e.elapsedDays} הימים שעברו (ההוצאה היומית הממוצעת), כפול ${e.spanDays} הימים של החודש.`)),
      step(3, n > 1 ? `הממוצע של ${n} החודשים הקודמים` : 'החודש הקודם',
        monthsList(e.months),
        n > 1 && avgFormula(e.months, e.average)),
      step(4, 'ההפרש',
        formula(`${money(e.projected)} − ${money(e.average)} = `, h('b', {}, money(Math.abs(e.diff)))),
        diffLine(e.diff, 'מהממוצע'))),
    h('div', { class: 'calc-note' },
      h('strong', {}, 'מה זה הוצאות משתנות?'),
      h('p', {}, 'כל ההוצאות חוץ מקטגוריות קבועות. הקבועות לא נספרות כאן, כי הן יורדות פעם בחודש ולא תלויות בקצב.'),
      e.fixedExcluded.length > 0 && h('p', { class: 'muted small' }, `לא נספרו החודש: ${e.fixedExcluded.map(c => `${c.name} ${money(c.amount)}`).join(' · ')}`),
      h('p', { class: 'muted small' }, 'זו הערכה: הוצאה גדולה אחת בתחילת החודש מגדילה את התחזית, והיא מתעדכנת כל יום.')),
    top.length > 0 && h('div', { class: 'section' },
      h('h3', { class: 'calc-h' }, 'ההוצאות המשתנות החודש'),
      h('ul', { class: 'calc-cats' }, top.map(c => h('li', {},
        h('span', { 'aria-hidden': 'true' }, c.icon || '❔'),
        h('span', { class: 'calc-cat-name' }, c.name),
        h('span', { class: 'calc-cat-amounts' }, h('b', {}, money(c.amount)), h('span', { class: 'muted small' }, `ממוצע ${money(c.average)}`)))))),
    h('button', { type: 'button', class: 'btn', onclick: () => { sheet.close(); openFlow(ctx, e.month, 'expense'); } }, 'כל ההוצאות של החודש')));
}

function category(ctx, i, e) {
  const n = e.months.length;
  const diff = e.amount - e.average;
  const sheet = openSheet(`${e.category.icon || ''} ${e.category.name}`, h('div', { class: 'calc' },
    h('p', { class: 'calc-lead' }, i.text),
    h('ol', { class: 'calc-steps' },
      step(1, `${monthLabel(e.month)}`, h('p', {}, 'הוצאת על הקטגוריה ', h('b', {}, money(e.amount)), '.')),
      step(2, n > 1 ? `הממוצע של ${n} החודשים הקודמים` : 'החודש הקודם', monthsList(e.months), n > 1 && avgFormula(e.months, e.average)),
      step(3, 'ההפרש', formula(`${money(e.amount)} − ${money(e.average)} = `, h('b', {}, money(Math.abs(diff)))), diffLine(diff, 'מהממוצע'))),
    h('button', { type: 'button', class: 'btn', onclick: () => { sheet.close(); ctx.navigate('transactions', { category: e.category.id }); } }, 'התנועות בקטגוריה')));
}

function recurring(ctx, i, e) {
  const sheet = openSheet('איך זה חושב', h('div', { class: 'calc' },
    h('p', { class: 'calc-lead' }, i.text),
    h('ol', { class: 'calc-steps' },
      step(1, `${e.count} חיובים קבועים`, h('p', {}, 'הוראות קבע ומנויים שחוזרים כל חודש: ', h('b', {}, money(e.recurring)), '.'),
        h('p', { class: 'muted small' }, 'חיוב דו-חודשי נספר כחצי לחודש. באשראי מתגלגל נספר החיוב הקבוע.')),
      e.installmentsCount > 0 && step(2, `${e.installmentsCount} עסקאות בתשלומים`, h('p', {}, 'התשלום החודשי של העסקאות שעוד לא הסתיימו: ', h('b', {}, money(e.installments)), '.')),
      step(e.installmentsCount > 0 ? 3 : 2, 'ביחד', formula(e.installmentsCount > 0 ? `${money(e.recurring)} + ${money(e.installments)} = ` : '', h('b', {}, money(e.total))))),
    h('button', { type: 'button', class: 'btn', onclick: () => { sheet.close(); ctx.navigate('recurring'); } }, 'לרשימה המלאה')));
}
