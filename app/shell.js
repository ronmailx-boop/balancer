// App shell: header with month picker, demo banner, bottom navigation, hash router,
// month swipe and pull-to-refresh.
import { h, monthLabel, shiftMonth, skeleton, errorState, toast, cycleMonth, cycleRange, todayLocal } from './ui.js';
import { api, messageFor } from './api.js';
import * as home from './views/home.js';
import * as month from './views/month.js';
import * as transactions from './views/transactions.js';
import * as budget from './views/budget.js';
import * as more from './views/more.js';
import * as trends from './views/trends.js';
import * as recurring from './views/recurring.js';
import * as accounts from './views/accounts.js';
import * as settings from './views/settings.js';
import * as categories from './views/categories.js';

const VIEWS = { home, month, transactions, budget, more, trends, recurring, accounts, settings, categories };
const NAV = [
  ['home', '🏠', 'בית'],
  ['month', '📊', 'חודשי'],
  ['transactions', '🧾', 'עסקאות'],
  ['budget', '🎯', 'תקציב'],
  ['more', '☰', 'עוד'],
];
const NAV_PARENT = { trends: 'more', recurring: 'more', accounts: 'more', settings: 'more', categories: 'more' };

export function startShell({ root, onLocked, lock }) {
  let cycleDay = 1; // the day a budget month starts (Settings), loaded below
  const nowMonth = () => cycleMonth(todayLocal(), cycleDay);
  let currentMonth = nowMonth();
  let demo = false;
  let renderSeq = 0;
  let lastRoute = null;

  // Note: ‹ and › are mirrored in RTL text, so '‹' renders pointing right
  const title = h('h1', { class: 'top-title' });
  const backBtn = h('button', { type: 'button', class: 'icon-btn back', 'aria-label': 'חזרה', hidden: true }, '‹');
  const prevBtn = h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'החודש הקודם', onclick: () => setMonth(shiftMonth(currentMonth, -1)) }, '‹');
  const nextBtn = h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'החודש הבא', onclick: () => setMonth(shiftMonth(currentMonth, 1)) }, '›');
  const monthText = h('span', { class: 'month-label', 'aria-live': 'polite' });
  const picker = h('div', { class: 'month-picker' }, prevBtn, monthText, nextBtn);
  const banner = h('div', { class: 'demo-banner', role: 'status', hidden: true }, '🧪 מצב הדגמה: נתונים לדוגמה בלבד');
  const pull = h('div', { class: 'pull', 'aria-hidden': 'true' }, '↻');
  const main = h('main', { class: 'content', id: 'content', tabindex: '-1' });
  const nav = h('nav', { class: 'bottom-nav', 'aria-label': 'ניווט ראשי' }, NAV.map(([route, icon, label]) =>
    h('button', { type: 'button', dataset: { route }, onclick: () => navigate(route) }, h('span', { class: 'nav-icon', 'aria-hidden': 'true' }, icon), h('span', {}, label))));

  root.replaceChildren(
    h('header', { class: 'topbar' }, h('div', { class: 'topbar-row' }, backBtn, title, picker)),
    banner, pull, main, nav);
  root.hidden = false;

  function parseHash() {
    const [path, qs] = location.hash.replace(/^#\/?/, '').split('?');
    const route = VIEWS[path] ? path : 'home';
    return { route, params: Object.fromEntries(new URLSearchParams(qs || '')) };
  }

  function navigate(route, params = {}, { replace = false, keepFocus = false } = {}) {
    const qs = new URLSearchParams(Object.entries(params).filter(([, v]) => v != null && v !== '')).toString();
    const hash = `#/${route}${qs ? `?${qs}` : ''}`;
    if (replace) history.replaceState(null, '', hash);
    else history.pushState(null, '', hash);
    render({ keepFocus });
  }

  function setMonth(m) {
    if (m > nowMonth()) return;
    currentMonth = m;
    render();
  }

  function setCycleDay(day) {
    cycleDay = day;
    currentMonth = nowMonth();
  }

  function setDemo(on) {
    demo = Boolean(on);
    banner.hidden = !demo;
  }

  async function render({ keepScroll = false, keepFocus = false } = {}) {
    const seq = ++renderSeq;
    const { route, params } = parseHash();
    const view = VIEWS[route];
    // A sheet belongs to the screen that opened it
    if (route !== lastRoute) {
      document.querySelectorAll('.sheet-overlay').forEach(el => el.remove());
      root.inert = false;
    }
    lastRoute = route;
    title.textContent = view.title;
    picker.hidden = !view.usesMonth || Boolean(params.from || params.to);
    const range = cycleRange(currentMonth, cycleDay);
    monthText.replaceChildren(h('span', {}, monthLabel(currentMonth)), range && h('span', { class: 'month-range' }, range));
    nextBtn.disabled = currentMonth >= nowMonth();
    backBtn.hidden = !view.back;
    backBtn.onclick = () => navigate(view.back);
    nav.querySelectorAll('button').forEach(b => {
      const active = b.dataset.route === (NAV_PARENT[route] || route);
      if (active) b.setAttribute('aria-current', 'page');
      else b.removeAttribute('aria-current');
    });
    const scroll = window.scrollY;
    if (!keepScroll && !keepFocus) main.replaceChildren(skeleton(3));
    const ctx = { month: currentMonth, cycleDay, params, navigate, setMonth, setDemo, setCycleDay, refresh: opts => render(opts), lock };
    try {
      const out = await view.render(ctx);
      if (seq !== renderSeq) return;
      const focused = keepFocus ? document.activeElement : null;
      const selStart = focused?.selectionStart;
      main.replaceChildren(...[out].flat(Infinity).filter(Boolean));
      if (keepFocus && focused?.type === 'search') {
        const again = main.querySelector('input[type=search]');
        again.focus();
        again.setSelectionRange(selStart, selStart);
      }
      if (keepScroll) window.scrollTo(0, scroll);
      else if (!keepFocus) window.scrollTo(0, 0);
    } catch (err) {
      if (seq !== renderSeq) return;
      if (err.code === 'unauthorized' || err.code === 'locked') return onLocked();
      main.replaceChildren(errorState(messageFor(err), () => render()));
    }
  }

  // Swipe between months (RTL: swiping right goes forward in time)
  let touch = null;
  main.addEventListener('touchstart', e => {
    const t = e.touches[0];
    touch = { x: t.clientX, y: t.clientY, top: window.scrollY <= 0 };
  }, { passive: true });
  main.addEventListener('touchmove', e => {
    if (!touch?.top) return;
    const dy = e.touches[0].clientY - touch.y;
    if (dy > 0) {
      pull.style.setProperty('--pull', `${Math.min(dy, 120)}px`);
      pull.classList.toggle('ready', dy > 80);
    }
  }, { passive: true });
  main.addEventListener('touchend', e => {
    if (!touch) return;
    const t = e.changedTouches[0];
    const dx = t.clientX - touch.x;
    const dy = t.clientY - touch.y;
    const { route } = parseHash();
    if (Math.abs(dx) > 70 && Math.abs(dx) > Math.abs(dy) * 1.8 && VIEWS[route].usesMonth && !e.target.closest('input, textarea, .chips, .account-strip')) {
      setMonth(shiftMonth(currentMonth, dx > 0 ? 1 : -1));
    } else if (touch.top && dy > 80 && Math.abs(dx) < 40) {
      pullRefresh();
    }
    pull.style.removeProperty('--pull');
    pull.classList.remove('ready');
    touch = null;
  });

  // Pull-to-refresh: syncs all connections (real data), then reloads the screen when done
  let syncWatch = null;
  async function pullRefresh() {
    if (demo) return render({ keepScroll: true });
    try {
      const r = await api('sync', { method: 'POST', body: { all: true } });
      if (!r.queued.length) {
        toast(r.skipped.some(s => s.reason === 'too_soon') ? 'הנתונים עדכניים (סונכרנו לאחרונה)' : 'אין חשבונות לסנכרון');
        return render({ keepScroll: true });
      }
      toast('מסנכרן… זה יכול לקחת כמה דקות');
      clearInterval(syncWatch);
      syncWatch = setInterval(async () => {
        try {
          const s = await api('sync/status');
          if (s.running || s.queued.length) return;
          clearInterval(syncWatch);
          const failed = Object.values(s.results).filter(x => !x.ok).length;
          toast(failed ? 'הסנכרון הסתיים עם שגיאות. פרטים במסך החשבונות.' : 'הסנכרון הסתיים');
          render({ keepScroll: true });
        } catch {
          clearInterval(syncWatch);
        }
      }, 3000);
    } catch (err) {
      toast(messageFor(err));
    }
  }

  window.addEventListener('popstate', () => render());
  api('prefs').then(p => setCycleDay(p.cycleDay), () => {}).finally(() => render());
  return { render, setDemo };
}
