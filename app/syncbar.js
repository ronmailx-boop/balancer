// Sync bar: a slim strip under the header while a sync runs (tap for the per-account list), then a
// short success note or an error card that stays until closed. It takes its own place in the page
// flow, so it never covers the screen or the bottom navigation.
import { h, s } from './ui.js';
import { api } from './api.js';
import { ERROR_TEXT, STAGE_TEXT } from './views/accounts.js';

const SUCCESS_MS = 5000;
const POLL_MS = 2500;

const icon = (paths, cls = '') => s('svg', { class: cls, width: 20, height: 20, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': 2.6, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true' },
  ...paths.map(d => s('path', { d })));
const SPIN = ['M21 12a9 9 0 1 1-6.2-8.56'];
const CHECK = ['M5 12.5l4.5 4.5L19 7.5'];
const ALERT = ['M12 7v6', 'M12 16.8v.1'];
const CLOSE = ['M6 6l12 12M18 6L6 18'];
const CHEVRON = ['M6 9l6 6 6-6'];

const timeOf = iso => new Date(iso).toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' });

export function createSyncBar({ navigate, onDone }) {
  const el = h('div', { class: 'syncbar', hidden: true });
  let timer = null;
  let hideTimer = null;
  let open = false;
  let last = null;
  let shown = ''; // what is on screen now, so polling does not restart the animations

  function hide() {
    clearTimeout(hideTimer);
    el.hidden = true;
    el.replaceChildren();
    shown = '';
  }

  // Each connection of the batch: done / failed / running / waiting
  function rows(conns, st) {
    const names = new Map(conns.map(c => [c.id, c.name]));
    return st.batch.ids.map(id => {
      const name = names.get(id) || 'חשבון';
      if (st.running?.connectionId === id) return { id, name, state: 'running', text: STAGE_TEXT[st.running.stage] || 'מסנכרן…' };
      if (st.queued.includes(id)) return { id, name, state: 'waiting', text: 'ממתין' };
      const r = st.results[id];
      if (!r) return { id, name, state: 'waiting', text: 'ממתין' };
      return r.ok ? { id, name, state: 'ok', text: 'עודכן', added: r.stats?.added || 0 }
        : { id, name, state: 'failed', text: ERROR_TEXT[r.errorType] || ERROR_TEXT.GENERIC, needsLogin: r.status === 'needs_attention' };
    });
  }

  function closeBtn() {
    return h('button', { type: 'button', class: 'syncbar-close', 'aria-label': 'סגירה', onclick: hide }, icon(CLOSE));
  }

  function showRunning(list, batch) {
    const done = list.filter(x => x.state === 'ok' || x.state === 'failed').length;
    const label = batch.auto ? `סנכרון אוטומטי · ${timeOf(batch.startedAt)}` : 'מסנכרן את החשבונות…';
    const head = h('button', { type: 'button', class: 'syncbar-head', 'aria-expanded': String(open), onclick: () => { open = !open; render(); } },
      icon(SPIN, 'spin'),
      h('span', { class: 'syncbar-title' }, label),
      h('span', { class: 'syncbar-count' }, `${done}/${list.length}`),
      icon(CHEVRON, open ? 'chev up' : 'chev'));
    const bar = h('span', { class: 'syncbar-track', 'aria-hidden': 'true' }, h('span', { class: 'syncbar-run' }));
    const details = open && h('ul', { class: 'syncbar-list' }, list.map(x => h('li', { class: `is-${x.state}` },
      h('span', { class: 'syncbar-dot', 'aria-hidden': 'true' }, x.state === 'ok' ? icon(CHECK) : x.state === 'running' ? icon(SPIN, 'spin') : x.state === 'failed' ? icon(ALERT) : null),
      h('span', { class: 'syncbar-name' }, x.name),
      h('span', { class: 'syncbar-state' }, x.state === 'failed' ? 'נכשל' : x.text))));
    el.className = `syncbar running${open ? ' open' : ''}`;
    el.setAttribute('role', 'status');
    el.replaceChildren(head, bar, details || '');
  }

  function showSuccess(list) {
    const added = list.reduce((n, x) => n + (x.added || 0), 0);
    el.className = 'syncbar success';
    el.setAttribute('role', 'status');
    el.replaceChildren(
      h('div', { class: 'syncbar-row' },
        h('span', { class: 'syncbar-badge ok' }, icon(CHECK)),
        h('span', { class: 'syncbar-text' },
          h('strong', {}, 'הסנכרון הושלם'),
          h('span', {}, `${list.length === 1 ? 'חשבון אחד' : `${list.length} חשבונות`} · ${added === 0 ? 'אין תנועות חדשות' : added === 1 ? 'תנועה חדשה אחת' : `${added} תנועות חדשות`}`)),
        closeBtn()),
      h('span', { class: 'syncbar-drain', 'aria-hidden': 'true' }, h('span', {})));
    clearTimeout(hideTimer);
    hideTimer = setTimeout(hide, SUCCESS_MS);
  }

  function showError(list) {
    const failed = list.filter(x => x.state === 'failed');
    const okCount = list.length - failed.length;
    const needsLogin = failed.some(x => x.needsLogin);
    el.className = 'syncbar error';
    el.setAttribute('role', 'alert');
    el.replaceChildren(
      h('div', { class: 'syncbar-row' },
        h('span', { class: 'syncbar-badge bad' }, icon(ALERT)),
        h('span', { class: 'syncbar-text' },
          h('strong', {}, failed.length === 1 ? `${failed[0].name} לא סונכרן` : `${failed.length} חשבונות לא סונכרנו`),
          h('span', {}, `${okCount} מתוך ${list.length} חשבונות עודכנו`)),
        closeBtn()),
      h('ul', { class: 'syncbar-errors' }, failed.map(x => h('li', {}, failed.length > 1 && h('strong', {}, `${x.name}: `), x.text))),
      h('div', { class: 'syncbar-actions' },
        needsLogin && h('button', { type: 'button', class: 'btn primary', onclick: () => { hide(); navigate('accounts'); } }, 'עדכון פרטי התחברות'),
        h('button', { type: 'button', class: needsLogin ? 'btn' : 'btn primary', onclick: () => { hide(); navigate('accounts'); } }, 'פרטים')));
    clearTimeout(hideTimer);
  }

  function render() {
    if (!last) return;
    const { conns, st } = last;
    if (!st.batch?.ids.length) return hide();
    const list = rows(conns, st);
    const key = JSON.stringify([list, open, st.batch.startedAt]);
    if (key === shown && !el.hidden) return;
    shown = key;
    el.hidden = false;
    if (st.running || st.queued.length) return showRunning(list, st.batch);
    if (list.some(x => x.state === 'failed')) return showError(list);
    showSuccess(list);
  }

  async function poll() {
    try {
      const r = await api('connections');
      last = { conns: r.connections, st: r.sync };
      if (!r.sync.batch) {
        clearInterval(timer);
        timer = null;
        return hide();
      }
      const busy = r.sync.running || r.sync.queued.length;
      render();
      if (!busy) {
        clearInterval(timer);
        timer = null;
        onDone(!rows(r.connections, r.sync).some(x => x.state === 'failed'));
      }
    } catch {
      clearInterval(timer);
      timer = null;
      hide();
    }
  }

  // Starts following the sync (safe to call again while already following)
  function watch() {
    if (timer) return;
    open = false;
    clearTimeout(hideTimer);
    timer = setInterval(poll, POLL_MS);
    poll();
  }

  return { el, watch, hide };
}
