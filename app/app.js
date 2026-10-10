import { api, session, messageFor } from './api.js';

const $ = id => document.getElementById(id);
const VIEWS = ['loading', 'setup', 'unlock', 'home'];

function show(view) {
  for (const v of VIEWS) $(`view-${v}`).hidden = v !== view;
  const first = $(`view-${view}`).querySelector('input');
  if (first) first.focus();
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
  try {
    const status = await api('status');
    if (!status.initialized) return show('setup');
    if (status.unlocked && session.token) {
      try {
        await loadHome();
        return show('home');
      } catch { /* token from an old session */ }
    }
    session.token = null;
    show('unlock');
  } catch (e) {
    $('global-error').textContent = messageFor(e);
    $('global-error').hidden = false;
  }
}

async function loadHome() {
  const info = await api('info');
  $('info-schema').textContent = info.schemaVersion;
  $('info-idle').textContent = `${info.idleMinutes} דקות`;
}

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
      await loadHome();
      show('home');
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
      await loadHome();
      show('home');
    } catch (err) {
      setError('unlock-error', messageFor(err));
      $('unlock-password').select();
    }
  });
});

$('btn-lock').addEventListener('click', async () => {
  try { await api('lock', { method: 'POST', body: {} }); } catch { /* lock locally anyway */ }
  session.token = null;
  show('unlock');
});

$('form-password').addEventListener('submit', e => {
  e.preventDefault();
  setError('password-error');
  setError('password-ok');
  const newPassword = $('pw-new').value;
  if ([...newPassword].length < 8) return setError('password-error', messageFor({ code: 'weak_password' }));
  if (newPassword !== $('pw-confirm').value) return setError('password-error', 'הסיסמאות החדשות לא זהות.');
  busy(e.target, async () => {
    try {
      await api('password', { method: 'POST', body: { oldPassword: $('pw-old').value, newPassword } });
      e.target.reset();
      setError('password-ok', 'הסיסמה הוחלפה.');
    } catch (err) {
      if (err.code === 'unauthorized' || err.code === 'locked') return route();
      setError('password-error', messageFor(err));
    }
  });
});

// Re-check when coming back to the tab (the vault may have auto-locked)
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && !$('view-home').hidden) route();
});

route();
