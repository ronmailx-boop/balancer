// Small DOM helpers. All user and bank text goes in through textContent (h() children), never innerHTML.

export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'style') for (const [p, val] of Object.entries(v)) el.style.setProperty(p, val);
    else if (k.startsWith('on')) el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (v === true) el.setAttribute(k, '');
    else el.setAttribute(k, v);
  }
  append(el, children);
  return el;
}

function append(el, children) {
  for (const c of children.flat(Infinity)) {
    if (c == null || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
}

const SVG_NS = 'http://www.w3.org/2000/svg';
export function s(tag, attrs = {}, ...children) {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) if (v != null) el.setAttribute(k, v);
  for (const c of children.flat()) if (c != null) el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  return el;
}

const nf0 = new Intl.NumberFormat('he-IL', { maximumFractionDigits: 0 });
const nf2 = new Intl.NumberFormat('he-IL', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// ₪ before the number, LTR-isolated so the minus sign stays in place inside RTL text
export function money(n, { decimals = false, sign = false } = {}) {
  const v = Number(n) || 0;
  const abs = (decimals ? nf2 : nf0).format(Math.abs(v));
  const prefix = v < 0 ? '-' : sign && v > 0 ? '+' : '';
  return `⁦${prefix}₪${abs}⁩`;
}

export function foreign(amount, currency) {
  try {
    return `⁦${new Intl.NumberFormat('he-IL', { style: 'currency', currency }).format(amount)}⁩`;
  } catch {
    return `${amount} ${currency}`;
  }
}

const monthFmt = new Intl.DateTimeFormat('he-IL', { month: 'long', year: 'numeric' });
const monthShort = new Intl.DateTimeFormat('he-IL', { month: 'short' });
const dayFmt = new Intl.DateTimeFormat('he-IL', { weekday: 'long', day: 'numeric', month: 'long' });
const dateFmt = new Intl.DateTimeFormat('he-IL', { day: 'numeric', month: 'numeric' });

const toDate = iso => {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d || 1);
};
export const monthLabel = m => monthFmt.format(toDate(m));
export const monthShortLabel = m => monthShort.format(toDate(m));
export const dayLabel = iso => dayFmt.format(toDate(iso));
export const shortDate = iso => dateFmt.format(toDate(iso));

export function shiftMonth(month, delta) {
  const d = toDate(month);
  d.setMonth(d.getMonth() + delta);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

// Budget cycle helpers (mirror server/queries.js): with day 10, "2026-10" is 10.10–9.11
const pad = n => String(n).padStart(2, '0');
export const todayLocal = () => {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};
export function cycleMonth(dayIso, day = 1) {
  const m = dayIso.slice(0, 7);
  return Number(dayIso.slice(8, 10)) < day ? shiftMonth(m, -1) : m;
}
export function cycleRange(month, day = 1) {
  if (day === 1) return '';
  const end = toDate(`${shiftMonth(month, 1)}-${pad(day)}`);
  end.setDate(end.getDate() - 1);
  return `${shortDate(`${month}-${pad(day)}`)}–${dateFmt.format(end)}`;
}
// "Max 1228" already carries its number; don't print it twice
export const accountLabel = (name, masked) => (masked && !String(name).includes(masked) ? `${name} ••${masked}` : name);

export function relativeDays(iso, todayIso) {
  const days = Math.round((toDate(iso) - toDate(todayIso)) / 86400000);
  if (days === 0) return 'היום';
  if (days === 1) return 'מחר';
  if (days > 1) return `בעוד ${days} ימים`;
  return shortDate(iso);
}

export function card(...children) {
  return h('section', { class: 'card' }, ...children);
}

export function cardTitle(text, extra) {
  return h('div', { class: 'card-head' }, h('h2', {}, text), extra);
}

export function skeleton(lines = 3) {
  return h('div', { class: 'skeleton-wrap', 'aria-busy': 'true' },
    Array.from({ length: lines }, (_, i) => h('div', { class: `skeleton card ${i === 0 ? 'tall' : ''}` })));
}

export function emptyState(icon, title, text, action) {
  return h('div', { class: 'empty' }, h('div', { class: 'empty-icon', 'aria-hidden': 'true' }, icon), h('h3', {}, title), text && h('p', {}, text), action);
}

export function errorState(message, retry) {
  return emptyState('⚠️', 'משהו השתבש', message, retry && h('button', { class: 'btn', type: 'button', onclick: retry }, 'לנסות שוב'));
}

let toastTimer;
export function toast(text) {
  let el = document.getElementById('toast');
  if (!el) {
    el = h('div', { id: 'toast', class: 'toast', role: 'status' });
    document.body.append(el);
  }
  el.textContent = text;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2600);
}

// Bottom sheet (modal dialog). Returns { close }.
export function openSheet(title, content, { onClose } = {}) {
  const previousFocus = document.activeElement;
  // The page behind a sheet is inert: screen readers and the keyboard stay inside the sheet
  const shell = document.getElementById('shell');
  const close = () => {
    if (shell && document.querySelectorAll('.sheet-overlay').length <= 1) shell.inert = false;
    overlay.classList.remove('open');
    document.removeEventListener('keydown', onKey);
    setTimeout(() => overlay.remove(), 200);
    onClose?.();
    previousFocus?.focus?.();
  };
  const onKey = e => { if (e.key === 'Escape') close(); };
  const panel = h('div', { class: 'sheet', role: 'dialog', 'aria-modal': 'true', 'aria-label': title },
    h('div', { class: 'sheet-grip', 'aria-hidden': 'true' }),
    h('div', { class: 'sheet-head' }, h('h2', {}, title), h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'סגירה', onclick: close }, '✕')),
    h('div', { class: 'sheet-body' }, content));
  const overlay = h('div', { class: 'sheet-overlay', onclick: e => { if (e.target === overlay) close(); } }, panel);
  document.body.append(overlay);
  if (shell) shell.inert = true;
  document.addEventListener('keydown', onKey);
  requestAnimationFrame(() => overlay.classList.add('open'));
  setTimeout(() => panel.querySelector('button, input, select, textarea')?.focus(), 50);
  return { close, panel };
}

// Status for budget progress: always paired with a text label, never color alone
export function budgetStatus(spent, planned, fixed = false) {
  if (!planned) return { level: 'none', label: '' };
  const ratio = spent / planned;
  if (ratio > 1.005) return { level: 'critical', label: 'חריגה' };
  if (!fixed && ratio >= 0.85) return { level: 'warning', label: 'קרוב לגבול' };
  return { level: 'good', label: 'בתקציב' };
}

export function progress(spent, planned, fixed = false) {
  const st = budgetStatus(spent, planned, fixed);
  const pct = planned ? Math.min(spent / planned, 1) * 100 : 0;
  return h('div', { class: `progress ${st.level}`, role: 'img', 'aria-label': planned ? `${Math.round(spent / planned * 100)}% מהתקציב` : 'אין תקציב' },
    h('div', { class: 'progress-fill', style: { width: `${pct}%` } }));
}
