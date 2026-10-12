import { api, session, messageFor } from './api.js';
import { startShell } from './shell.js';
import { restoreBackup } from './backup.js';

const $ = id => document.getElementById(id);
const AUTH_VIEWS = ['loading', 'setup', 'unlock', 'offline', 'restore'];
let retryTimer = null;
let loadedVersion = null;
let shell = null;

function showAuth(view) {
  $('auth').hidden = false;
  $('shell').hidden = true;
  for (const v of AUTH_VIEWS) $(`view-${v}`).hidden = v !== view;
  $(`view-${view}`).querySelector('input')?.focus();
}

function setError(id, text = '') {
  $(id).textContent = text;
}

async function busy(form, fn) {
  const btn = form.querySelector('button[type=submit]');
  btn.disabled = true;
  try { await fn(); } finally { btn.disabled = false; }
}

async function route() {
  $('global-error').hidden = true;
  clearTimeout(retryTimer);
  try {
    const status = await api('status');
    // A new version was installed since this page loaded: load it (the session token survives)
    if (loadedVersion && status.version && status.version !== loadedVersion) return location.reload();
    loadedVersion = status.version;
    if (!status.initialized) return showAuth('setup');
    if (status.unlocked && session.token) {
      try {
        await api('info');
        return openApp();
      } catch { /* token from an old session */ }
    }
    session.token = null;
    showAuth('unlock');
  } catch (e) {
    if (e.code === 'network') {
      showAuth('offline');
      retryTimer = setTimeout(route, 3000); // reconnect by itself once start.sh is running
      return;
    }
    $('global-error').textContent = messageFor(e);
    $('global-error').hidden = false;
  }
}

function openApp() {
  $('auth').hidden = true;
  if (!location.hash) history.replaceState(null, '', '#/home');
  if (shell) shell.render();
  else shell = startShell({ root: $('shell'), onLocked: lockedOut, lock });
  $('shell').hidden = false;
}

function lockedOut() {
  session.token = null;
  showAuth('unlock');
}

async function lock() {
  try { await api('lock', { method: 'POST', body: {} }); } catch { /* lock locally anyway */ }
  lockedOut();
}

$('btn-retry').addEventListener('click', route);

$('form-setup').addEventListener('submit', e => {
  e.preventDefault();
  const pw = $('setup-password').value;
  if ([...pw].length < 8) return setError('setup-error', messageFor({ code: 'weak_password' }));
  if (pw !== $('setup-confirm').value) return setError('setup-error', 'הסיסמאות לא זהות.');
  setError('setup-error');
  busy(e.target, async () => {
    try {
      const { token } = await api('setup', { method: 'POST', body: { password: pw } });
      session.token = token;
      e.target.reset();
      openApp();
    } catch (err) {
      setError('setup-error', messageFor(err));
    }
  });
});

$('form-unlock').addEventListener('submit', e => {
  e.preventDefault();
  setError('unlock-error');
  busy(e.target, async () => {
    try {
      const { token } = await api('unlock', { method: 'POST', body: { password: $('unlock-password').value } });
      session.token = token;
      e.target.reset();
      openApp();
    } catch (err) {
      setError('unlock-error', messageFor(err));
      $('unlock-password').select();
    }
  });
});

// Coming back to the tab: the vault may have auto-locked meanwhile
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && !$('shell').hidden) route();
});

// Restore from an encrypted backup on a fresh install (e.g. a new phone)
$('btn-show-restore').addEventListener('click', () => showAuth('restore'));
$('btn-cancel-restore').addEventListener('click', () => showAuth('setup'));
$('form-restore').addEventListener('submit', e => {
  e.preventDefault();
  setError('restore-error');
  const file = $('restore-file').files[0];
  if (!file) return setError('restore-error', 'יש לבחור קובץ גיבוי.');
  busy(e.target, async () => {
    try {
      session.token = await restoreBackup(file, $('restore-password').value);
      e.target.reset();
      openApp();
    } catch (err) {
      setError('restore-error', messageFor(err));
    }
  });
});

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').catch(() => { /* offline shell is optional */ });
}

route();
