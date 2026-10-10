// Category and rule management: own categories, and "text -> category" rules.
import { api, messageFor } from '../api.js';
import { h, card, cardTitle, openSheet, toast } from '../ui.js';

export const title = 'קטגוריות וחוקים';
export const back = 'more';

const TYPE_LABEL = { expense: 'הוצאות', income: 'הכנסות', transfer: 'העברות (לא נספרות)' };
const MATCH_LABEL = { contains: 'מכיל', exact: 'בדיוק' };

export async function render(ctx) {
  const m = await api('categories/manage');
  const groups = ['expense', 'income', 'transfer'].map(type => [type, m.categories.filter(c => c.type === type)]).filter(([, list]) => list.length);
  const reload = () => ctx.refresh({ keepScroll: true });

  return [
    card(cardTitle('חוקי סיווג', h('button', { class: 'link', type: 'button', onclick: () => openRule(m.categories, reload) }, '+ חוק חדש')),
      h('p', { class: 'muted small' }, `עסקה שהתיאור שלה מתאים לחוק מקבלת את הקטגוריה שלו אוטומטית, גם עסקאות קודמות. החוקים שלך קודמים ל-${m.systemRuleCount} החוקים המובנים.`),
      m.rules.length
        ? h('ul', { class: 'list' }, m.rules.map(r => h('li', { class: 'list-row' },
          h('span', { class: 'list-icon', 'aria-hidden': 'true' }, r.categoryIcon),
          h('span', { class: 'list-main' }, h('span', {}, `"${r.pattern}"`), h('span', { class: 'muted small' }, `${MATCH_LABEL[r.matchType] || r.matchType} ← ${r.categoryName}`)),
          h('button', { type: 'button', class: 'icon-btn', 'aria-label': `מחיקת החוק ${r.pattern}`, onclick: () => removeRule(r, reload) }, '🗑️'))))
        : h('p', { class: 'muted' }, 'עוד אין חוקים משלך. אפשר גם ליצור חוק מתוך עסקה: לבחור קטגוריה ולסמן "תמיד לסווג כך".')),

    card(cardTitle('קטגוריות', h('button', { class: 'link', type: 'button', onclick: () => openCategory(null, reload) }, '+ קטגוריה חדשה')),
      groups.map(([type, list]) => h('section', { class: 'cat-group' },
        h('h3', { class: 'field-title' }, TYPE_LABEL[type]),
        h('ul', { class: 'list' }, list.map(c => h('li', {},
          h('button', { type: 'button', class: 'list-row list-button', onclick: () => openCategory(c, reload) },
            h('span', { class: 'list-icon', 'aria-hidden': 'true' }, c.icon),
            h('span', { class: 'list-main' }, h('span', {}, c.name),
              h('span', { class: 'muted small' }, [`${c.txCount} עסקאות`, c.ruleCount && `${c.ruleCount} חוקים`, c.fixed && 'קבועה', c.custom && 'שלי'].filter(Boolean).join(' · '))),
            h('span', { class: 'list-chevron', 'aria-hidden': 'true' }, '‹')))))))),
  ];
}

function openCategory(c, done) {
  const name = h('input', { id: 'cat-name', type: 'text', maxlength: 30, required: true, value: c?.name || '' });
  const icon = h('input', { id: 'cat-icon', type: 'text', maxlength: 8, value: c?.icon || '🏷️', class: 'icon-input' });
  const type = h('select', { id: 'cat-type', disabled: Boolean(c && !c.custom) },
    Object.entries(TYPE_LABEL).map(([v, label]) => h('option', { value: v, selected: (c?.type || 'expense') === v }, label)));
  const fixed = h('input', { type: 'checkbox', id: 'cat-fixed', checked: Boolean(c?.fixed) });
  const error = h('p', { class: 'error', role: 'alert' });
  const save = h('button', { type: 'submit', class: 'btn primary' }, c ? 'שמירה' : 'הוספה');
  const del = c?.custom && h('button', { type: 'button', class: 'btn danger' }, 'מחיקת הקטגוריה');
  const form = h('form', { novalidate: true },
    h('div', { class: 'pair' },
      h('div', {}, h('label', { for: 'cat-name' }, 'שם'), name),
      h('div', { class: 'narrow' }, h('label', { for: 'cat-icon' }, 'אייקון'), icon)),
    h('label', { for: 'cat-type' }, 'סוג'), type,
    c && !c.custom && h('p', { class: 'muted small' }, 'בקטגוריה מובנית אפשר לשנות שם, אייקון וקבועה, אבל לא את הסוג.'),
    h('label', { class: 'check', for: 'cat-fixed' }, fixed, 'הוצאה קבועה (שכר דירה, ביטוח…): לא מתריעים כשמתקרבים לתקציב'),
    error, save, del);
  const sheet = openSheet(c ? `עריכת ${c.name}` : 'קטגוריה חדשה', form);
  form.addEventListener('submit', async e => {
    e.preventDefault();
    if (!name.value.trim()) return (error.textContent = 'יש למלא שם.');
    save.disabled = true;
    try {
      await api('categories/save', { method: 'POST', body: { id: c?.id, name: name.value, icon: icon.value, type: type.value, fixed: fixed.checked } });
      sheet.close();
      toast('נשמר');
      done();
    } catch (err) {
      error.textContent = messageFor(err);
      save.disabled = false;
    }
  });
  del?.addEventListener('click', async () => {
    if (!confirm(`למחוק את "${c.name}"? ${c.txCount} העסקאות שלה יחזרו לסיווג האוטומטי, והחוקים והתקציב שלה יימחקו.`)) return;
    del.disabled = true;
    try {
      await api('categories/delete', { method: 'POST', body: { id: c.id } });
      sheet.close();
      toast('הקטגוריה נמחקה');
      done();
    } catch (err) {
      error.textContent = messageFor(err);
      del.disabled = false;
    }
  });
}

function openRule(categories, done) {
  const pattern = h('input', { id: 'rule-pattern', type: 'text', maxlength: 60, required: true, placeholder: 'למשל: פז, WOLT, סופר' });
  const match = h('select', { id: 'rule-match' },
    h('option', { value: 'contains' }, 'התיאור מכיל את הטקסט'),
    h('option', { value: 'exact' }, 'התיאור זהה בדיוק'));
  const cat = h('select', { id: 'rule-cat' }, categories.map(c => h('option', { value: c.id }, `${c.icon} ${c.name}`)));
  const error = h('p', { class: 'error', role: 'alert' });
  const save = h('button', { type: 'submit', class: 'btn primary' }, 'הוספת החוק');
  const form = h('form', { novalidate: true },
    h('label', { for: 'rule-pattern' }, 'טקסט בתיאור העסקה'), pattern,
    h('label', { for: 'rule-match' }, 'התאמה'), match,
    h('label', { for: 'rule-cat' }, 'קטגוריה'), cat,
    h('p', { class: 'muted small' }, 'לא משנה אותיות גדולות או קטנות. עסקאות שסיווגת ידנית לא ישתנו.'),
    error, save);
  const sheet = openSheet('חוק סיווג חדש', form);
  form.addEventListener('submit', async e => {
    e.preventDefault();
    if (!pattern.value.trim()) return (error.textContent = 'יש למלא טקסט לחיפוש.');
    save.disabled = true;
    try {
      const r = await api('rules/add', { method: 'POST', body: { pattern: pattern.value, matchType: match.value, categoryId: cat.value } });
      sheet.close();
      toast(r.changed ? `החוק נוסף · ${r.changed} עסקאות סווגו מחדש` : 'החוק נוסף');
      done();
    } catch (err) {
      error.textContent = messageFor(err);
      save.disabled = false;
    }
  });
}

async function removeRule(r, done) {
  if (!confirm(`למחוק את החוק "${r.pattern}"?`)) return;
  try {
    await api('rules/delete', { method: 'POST', body: { id: r.id } });
    toast('החוק נמחק');
    done();
  } catch (err) {
    toast(messageFor(err));
  }
}
