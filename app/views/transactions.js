import { api, messageFor } from '../api.js';
import { h, card, money, foreign, dayLabel, shortDate, emptyState, openSheet, toast } from '../ui.js';

export const title = 'עסקאות';
export const usesMonth = true;

const TYPE_LABEL = { pending: 'ממתינה', installments: 'תשלומים' };
let categoriesCache = null;

export async function render(ctx) {
  const f = ctx.params; // category, account, q, recurring, min, max, from, to
  const [list, cats, accounts] = await Promise.all([
    api(`transactions?${query({ month: f.from || f.to ? '' : ctx.month, ...f })}`),
    categoriesCache ?? api('categories'),
    api('accounts'),
  ]);
  categoriesCache = cats;
  const catName = id => id === 'none' ? 'ללא קטגוריה' : cats.find(c => c.id === id)?.name;

  const search = h('input', {
    type: 'search', class: 'search', placeholder: 'חיפוש בית עסק, הערה או קטגוריה', value: f.q || '',
    'aria-label': 'חיפוש עסקאות', enterkeyhint: 'search',
  });
  let timer;
  search.addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(() => ctx.navigate('transactions', { ...f, q: search.value.trim() || undefined }, { replace: true, keepFocus: true }), 350);
  });

  const chip = (label, active, params) => h('button', { type: 'button', class: `chip ${active ? 'active' : ''}`, 'aria-pressed': String(active), onclick: () => ctx.navigate('transactions', params, { replace: true }) }, label);
  const activeFilters = [
    f.category && f.category !== 'none' && `קטגוריה: ${catName(f.category)}`,
    f.account && `חשבון: ${accounts.accounts.find(a => a.id === f.account)?.name || ''}`,
    (f.min || f.max) && `סכום ${f.min || 0}–${f.max || '∞'}`,
    (f.from || f.to) && `תאריכים ${f.from ? shortDate(f.from) : ''}–${f.to ? shortDate(f.to) : ''}`,
  ].filter(Boolean);

  const toolbar = h('div', { class: 'tx-toolbar' },
    search,
    h('div', { class: 'chips' },
      chip('הכל', !f.category && !f.recurring, { q: f.q }),
      chip('ללא קטגוריה', f.category === 'none', { ...f, category: f.category === 'none' ? undefined : 'none' }),
      chip('קבועות', Boolean(f.recurring), { ...f, recurring: f.recurring ? undefined : '1' }),
      h('button', { type: 'button', class: `chip ${activeFilters.length ? 'active' : ''}`, onclick: () => openFilters(ctx, f, cats, accounts.accounts) }, `סינון${activeFilters.length ? ` (${activeFilters.length})` : ''}`)),
    activeFilters.length > 0 && h('p', { class: 'muted small' }, activeFilters.join(' · '), ' ',
      h('button', { type: 'button', class: 'link', onclick: () => ctx.navigate('transactions', {}, { replace: true }) }, 'ניקוי')));

  if (!list.length) return [toolbar, emptyState('🔍', 'לא נמצאו עסקאות', f.q || activeFilters.length ? 'נסה לשנות את החיפוש או הסינון.' : 'אין תנועות בחודש הזה.')];

  // Group by day
  const groups = new Map();
  for (const t of list) {
    const day = t.type === 'installments' && t.processedDate ? t.processedDate : t.date;
    if (!groups.has(day)) groups.set(day, []);
    groups.get(day).push(t);
  }
  const total = list.filter(t => !t.excluded && t.categoryType !== 'transfer').reduce((s, t) => s + t.amount, 0);

  return [
    toolbar,
    h('p', { class: 'muted small tx-count' }, `${list.length} עסקאות · סה"כ ${money(total, { sign: true })}`),
    [...groups].map(([day, items]) => h('section', { class: 'day' },
      h('h3', { class: 'day-head' }, h('span', {}, dayLabel(day)), h('span', { class: 'muted' }, money(items.reduce((s, t) => s + (t.excluded || t.categoryType === 'transfer' ? 0 : t.amount), 0), { sign: true }))),
      card(h('ul', { class: 'tx-list' }, items.map(t => txRow(t, () => openDetail(ctx, t, cats))))))),
  ];
}

export function txRow(t, onclick) {
  return h('li', {},
    h('button', { type: 'button', class: `tx-row ${t.excluded ? 'excluded' : ''}`, onclick },
      h('span', { class: 'tx-icon', 'aria-hidden': 'true' }, t.categoryIcon || '❔'),
      h('span', { class: 'tx-main' },
        h('span', { class: 'tx-desc' }, t.description),
        h('span', { class: 'tx-meta' },
          h('span', {}, t.categoryName || 'ללא קטגוריה'),
          h('span', {}, ` · ${t.accountName}`),
          TYPE_LABEL[t.type] && h('span', { class: `badge ${t.type}` }, t.type === 'installments' ? `${t.installmentNumber}/${t.installmentTotal}` : TYPE_LABEL[t.type]),
          t.recurring && h('span', { class: 'badge' }, 'קבועה'),
          t.split && h('span', { class: 'badge' }, 'מפוצלת'),
          t.excluded && h('span', { class: 'badge' }, 'מוחרגת'))),
      h('span', { class: `tx-amount ${t.amount > 0 ? 'pos' : ''}` }, money(t.amount, { decimals: true, sign: t.amount > 0 }))));
}

export function openDetail(ctx, t, cats) {
  let selected = t.categoryId;
  const catGrid = h('div', { class: 'cat-grid', role: 'radiogroup', 'aria-label': 'קטגוריה' },
    cats.filter(c => c.type !== 'ignore').map(c => {
      const btn = h('button', { type: 'button', role: 'radio', class: 'cat-option', 'aria-checked': String(c.id === selected) },
        h('span', { 'aria-hidden': 'true' }, c.icon), h('span', {}, c.name));
      btn.addEventListener('click', () => {
        selected = c.id;
        catGrid.querySelectorAll('.cat-option').forEach(b => b.setAttribute('aria-checked', String(b === btn)));
        applyRow.hidden = selected === t.categoryId;
      });
      return btn;
    }));
  const applyAll = h('input', { type: 'checkbox', id: 'apply-all', checked: true });
  const applyRow = h('label', { class: 'check', for: 'apply-all', hidden: true }, applyAll, `תמיד לסווג את "${t.description}" כך (גם עסקאות קודמות)`);
  const notes = h('textarea', { id: 'tx-notes', rows: 2, maxlength: 500, placeholder: 'הערה' });
  notes.value = t.notes || '';
  const tags = h('input', { id: 'tx-tags', type: 'text', maxlength: 200, placeholder: 'למשל: חופשה, מתנות', value: t.tags.join(', ') });
  const excluded = h('input', { type: 'checkbox', id: 'tx-excluded', checked: t.excluded });
  const error = h('p', { class: 'error', role: 'alert' });
  const save = h('button', { type: 'submit', class: 'btn primary' }, 'שמירה');

  const form = h('form', { class: 'tx-detail', novalidate: true },
    h('div', { class: 'tx-detail-head' },
      h('span', { class: `tx-detail-amount ${t.amount > 0 ? 'pos' : ''}` }, money(t.amount, { decimals: true, sign: t.amount > 0 })),
      t.originalCurrency !== 'ILS' && h('span', { class: 'muted small' }, `סכום מקורי ${foreign(Math.abs(t.originalAmount), t.originalCurrency)}`),
      t.type === 'installments' && h('span', { class: 'muted small' }, `תשלום ${t.installmentNumber} מתוך ${t.installmentTotal} · עסקה מקורית ${money(Math.abs(t.originalAmount))}`),
      t.type === 'pending' && h('span', { class: 'badge pending' }, 'ממתינה לחיוב')),
    h('dl', { class: 'facts' },
      h('dt', {}, 'תאריך'), h('dd', {}, dayLabel(t.date)),
      t.processedDate && t.processedDate !== t.date && [h('dt', {}, 'תאריך חיוב'), h('dd', {}, dayLabel(t.processedDate))],
      h('dt', {}, 'חשבון'), h('dd', {}, `${t.accountName} ••${t.accountMasked}`),
      t.memo && [h('dt', {}, 'פרטים'), h('dd', {}, t.memo)]),
    h('h3', { class: 'field-title' }, 'קטגוריה'),
    catGrid,
    applyRow,
    h('label', { for: 'tx-notes' }, 'הערה'), notes,
    h('label', { for: 'tx-tags' }, 'תגיות (מופרדות בפסיק)'), tags,
    h('label', { class: 'check', for: 'tx-excluded' }, excluded, 'להחריג מהתקציב והסיכומים'),
    t.categoryType !== 'transfer' && t.type !== 'pending' && h('div', { class: 'split-box' },
      t.split && h('p', { class: 'muted small' }, 'העסקה מפוצלת לכמה קטגוריות.'),
      h('button', { type: 'button', class: 'btn', onclick: () => { sheet.close(); openSplit(ctx, t.id, cats); } }, t.split ? '✂️ עריכת הפיצול' : '✂️ פיצול לכמה קטגוריות')),
    error,
    save);

  const sheet = openSheet(t.description, form);
  form.addEventListener('submit', async e => {
    e.preventDefault();
    save.disabled = true;
    error.textContent = '';
    try {
      const res = await api('transactions/update', {
        method: 'POST',
        body: {
          id: t.id,
          ...(selected !== t.categoryId ? { categoryId: selected, applyToMerchant: applyAll.checked } : {}),
          notes: notes.value,
          tags: tags.value.split(',').map(x => x.trim()).filter(Boolean),
          excluded: excluded.checked,
        },
      });
      sheet.close();
      toast(res.applied > 1 ? `נשמר · עודכנו ${res.applied} עסקאות` : 'נשמר');
      ctx.refresh({ keepScroll: true });
    } catch (err) {
      error.textContent = messageFor(err);
      save.disabled = false;
    }
  });
}

// Split one transaction across categories; what is not assigned stays in its own category
async function openSplit(ctx, id, cats) {
  let t;
  try {
    t = await api(`transaction?id=${encodeURIComponent(id)}`);
  } catch (err) {
    return toast(messageFor(err));
  }
  const total = Math.abs(t.amount);
  const own = cats.find(c => c.id === t.categoryId);
  // Expense categories first; a new row starts on the first one that is not the transaction's own
  const options = [...cats.filter(c => c.type === 'expense'), ...cats.filter(c => c.type === 'income' || c.type === 'transfer')];
  const firstOther = options.find(c => c.id !== t.categoryId)?.id;
  const rowsEl = h('div', { class: 'split-rows' });
  const rest = h('p', { class: 'muted small', 'aria-live': 'polite' });
  const error = h('p', { class: 'error', role: 'alert' });
  let n = 0;

  const addRow = (categoryId = firstOther, amount = '') => {
    const i = ++n;
    const sel = h('select', { id: `split-cat-${i}`, 'aria-label': 'קטגוריה' },
      options.map(c => h('option', { value: c.id, selected: c.id === categoryId }, `${c.icon} ${c.name}`)));
    const amt = h('input', { id: `split-amt-${i}`, type: 'number', inputmode: 'decimal', min: 0, step: '0.01', value: amount, placeholder: 'סכום', 'aria-label': 'סכום' });
    const row = h('div', { class: 'split-row' }, sel, amt,
      h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'הסרת שורה', onclick: () => { row.remove(); update(); } }, '✕'));
    amt.addEventListener('input', update);
    rowsEl.append(row);
    update();
  };
  const parts = () => [...rowsEl.querySelectorAll('.split-row')].map(r => ({ categoryId: r.querySelector('select').value, amount: Number(r.querySelector('input').value) }));
  function update() {
    const used = parts().reduce((s, p) => s + (p.amount > 0 ? p.amount : 0), 0);
    const left = Math.round((total - used) * 100) / 100;
    rest.textContent = left >= 0 ? `נשאר ב${own ? own.name : 'ללא קטגוריה'}: ${money(left, { decimals: true })}` : `חריגה של ${money(-left, { decimals: true })} מסכום העסקה`;
    rest.classList.toggle('neg', left < 0);
  }

  // Existing parts, except the remainder that sits in the transaction's own category
  const existing = t.splits.filter((p, i) => !(p.categoryId === t.categoryId && i === t.splits.length - 1));
  if (existing.length) existing.forEach(p => addRow(p.categoryId, Math.abs(p.amount)));
  else addRow();

  const save = h('button', { type: 'submit', class: 'btn primary' }, 'שמירת הפיצול');
  const form = h('form', { class: 'split-form', novalidate: true },
    h('p', {}, `${t.description} · ${money(total, { decimals: true })}`),
    rowsEl,
    h('button', { type: 'button', class: 'link', onclick: () => addRow() }, '+ עוד קטגוריה'),
    rest, error, save,
    t.split && h('button', { type: 'button', class: 'btn danger', onclick: () => submit([]) }, 'ביטול הפיצול'));
  const sheet = openSheet('פיצול עסקה', form);
  async function submit(list) {
    error.textContent = '';
    if (list.some(p => !(p.amount > 0))) return (error.textContent = 'יש למלא סכום חיובי בכל שורה.');
    save.disabled = true;
    try {
      await api('transactions/split', { method: 'POST', body: { id: t.id, parts: list } });
      sheet.close();
      toast(list.length ? 'העסקה פוצלה' : 'הפיצול בוטל');
      ctx.refresh({ keepScroll: true });
    } catch (err) {
      error.textContent = messageFor(err);
      save.disabled = false;
    }
  }
  form.addEventListener('submit', e => { e.preventDefault(); submit(parts()); });
}

function openFilters(ctx, f, cats, accounts) {
  const sel = (id, options, value) => {
    const el = h('select', { id }, h('option', { value: '' }, 'הכל'), options.map(([v, label]) => h('option', { value: v, selected: v === value }, label)));
    return el;
  };
  const category = sel('f-cat', [['none', 'ללא קטגוריה'], ...cats.map(c => [c.id, `${c.icon} ${c.name}`])], f.category);
  const account = sel('f-acc', accounts.map(a => [a.id, `${a.name} ••${a.masked}`]), f.account);
  const min = h('input', { id: 'f-min', type: 'number', inputmode: 'decimal', min: 0, value: f.min || '' });
  const max = h('input', { id: 'f-max', type: 'number', inputmode: 'decimal', min: 0, value: f.max || '' });
  const from = h('input', { id: 'f-from', type: 'date', value: f.from || '' });
  const to = h('input', { id: 'f-to', type: 'date', value: f.to || '' });
  const form = h('form', { class: 'filters', novalidate: true },
    h('label', { for: 'f-cat' }, 'קטגוריה'), category,
    h('label', { for: 'f-acc' }, 'חשבון'), account,
    h('div', { class: 'pair' },
      h('div', {}, h('label', { for: 'f-min' }, 'סכום מ-'), min),
      h('div', {}, h('label', { for: 'f-max' }, 'עד'), max)),
    h('div', { class: 'pair' },
      h('div', {}, h('label', { for: 'f-from' }, 'מתאריך'), from),
      h('div', {}, h('label', { for: 'f-to' }, 'עד תאריך'), to)),
    h('p', { class: 'muted small' }, 'טווח תאריכים מחליף את בחירת החודש.'),
    h('button', { type: 'submit', class: 'btn primary' }, 'הצגת תוצאות'));
  const sheet = openSheet('סינון עסקאות', form);
  form.addEventListener('submit', e => {
    e.preventDefault();
    sheet.close();
    ctx.navigate('transactions', {
      q: f.q, recurring: f.recurring,
      category: category.value || undefined, account: account.value || undefined,
      min: min.value || undefined, max: max.value || undefined, from: from.value || undefined, to: to.value || undefined,
    }, { replace: true });
  });
}

function query(obj) {
  return new URLSearchParams(Object.entries(obj).filter(([, v]) => v != null && v !== '')).toString();
}
