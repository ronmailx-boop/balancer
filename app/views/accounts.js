import { api, messageFor } from '../api.js';
import { h, card, cardTitle, money, emptyState, openSheet, toast } from '../ui.js';

export const title = 'חשבונות וחיבורים';
export const back = 'more';

const STATUS = {
  ok: ['good', '✅', 'מחובר'],
  syncing: ['good', '🔄', 'מסנכרן…'],
  needs_attention: ['critical', '⛔', 'דורש טיפול'],
  otp_required: ['warning', '⚠️', 'האתר ביקש קוד אימות'],
  error: ['critical', '⛔', 'הסנכרון האחרון נכשל'],
};

export const ERROR_TEXT = {
  INVALID_PASSWORD: 'שם המשתמש או הסיסמה שגויים. יש לעדכן את פרטי ההתחברות. לא ננסה שוב לבד, כדי שהחשבון לא יינעל.',
  CHANGE_PASSWORD: 'האתר מבקש להחליף סיסמה. יש להחליף אותה באתר הרשמי, ואז לעדכן כאן.',
  ACCOUNT_BLOCKED: 'החשבון חסום באתר. יש לפנות לבנק או לחברת האשראי.',
  TWO_FACTOR_RETRIEVER_MISSING: 'האתר ביקש קוד חד-פעמי. אפשר להיכנס פעם אחת לאתר הרשמי מהטלפון ולנסות שוב מאוחר יותר.',
  TIMEOUT: 'האתר לא הגיב בזמן. אפשר לנסות שוב מאוחר יותר.',
  GENERIC: 'הסנכרון נכשל. ייתכן שאין חיבור לאינטרנט או שהאתר השתנה.',
  GENERAL_ERROR: 'הסנכרון נכשל. ייתכן שאין חיבור לאינטרנט או שהאתר השתנה.',
  WORKER_ERROR: 'הדפדפן לא הצליח לעלות. ודא ש-Chromium מותקן ב-Termux (bash scripts/install.sh).',
  MERGE_ERROR: 'הנתונים התקבלו אבל שמירתם נכשלה. נסה שוב.',
  INTERRUPTED: 'הסנכרון הקודם הופסק באמצע (השרת נסגר או שהכספת ננעלה).',
};

export const STAGE_TEXT = {
  STARTING: 'מתחיל…',
  INITIALIZING: 'פותח דפדפן…',
  START_SCRAPING: 'פותח את האתר…',
  LOGGING_IN: 'מתחבר…',
  LOGIN_SUCCESS: 'מחובר, מוריד נתונים…',
  END_SCRAPING: 'מסיים…',
  TERMINATING: 'סוגר…',
  LOGIN_FAILED: 'ההתחברות נכשלה',
  CHANGE_PASSWORD: 'האתר מבקש להחליף סיסמה',
};

const SKIP_TEXT = {
  needs_attention: 'יש לעדכן קודם את פרטי ההתחברות.',
  already_running: 'הסנכרון כבר רץ.',
  too_soon: 'סונכרן לאחרונה. אפשר לנסות שוב בעוד כמה דקות.',
};

let poll = null;

export async function render(ctx) {
  clearTimeout(poll);
  const data = await api('connections');
  if (data.demo) return renderDemo(ctx);

  const { connections, sync } = data;
  const { accounts } = await api('accounts');
  const addBtn = h('button', { type: 'button', class: 'btn primary', onclick: () => openAdd(ctx) }, '➕ הוספת בנק או כרטיס אשראי');

  if (sync.running || sync.queued.length) {
    poll = setTimeout(() => { if (location.hash.startsWith('#/accounts')) ctx.refresh({ keepScroll: true }); }, 2000);
  }

  if (!connections.length) {
    return [
      emptyState('🏦', 'אין עדיין חשבונות מחוברים', 'מתחילים עם לאומי, כאל ומקס. פרטי ההתחברות נשמרים מוצפנים רק בטלפון.', addBtn),
    ];
  }

  return [
    connections.map(c => connectionCard(ctx, c, accounts.filter(a => a.connectionId === c.id), sync)),
    connections.length > 1 && h('button', {
      type: 'button', class: 'btn', disabled: Boolean(sync.running), onclick: () => syncNow(ctx, { all: true }),
    }, '🔄 סנכרון כל החשבונות'),
    addBtn,
    h('p', { class: 'muted small center' }, 'הסנכרון רץ בטלפון בלבד. פרטי ההתחברות מוצפנים ונפתחים רק בזמן הסנכרון.'),
  ];
}

function connectionCard(ctx, c, accounts, sync) {
  const running = sync.running?.connectionId === c.id;
  const queued = sync.queued.includes(c.id);
  const [level, icon, label] = running ? STATUS.syncing : (STATUS[c.status] || STATUS.error);
  const last = sync.results[c.id];
  const detail = !running && c.status !== 'ok' && c.statusDetail ? ERROR_TEXT[c.statusDetail] || ERROR_TEXT.GENERIC : null;

  return card(
    cardTitle(c.name, h('span', { class: 'badge' }, c.kind === 'bank' ? 'בנק' : 'כרטיס אשראי')),
    h('p', { class: `status-label ${level}` }, icon, ' ', running ? STAGE_TEXT[sync.running.stage] || label : queued ? 'ממתין בתור…' : label),
    detail && h('p', { class: 'hint' }, detail),
    last?.ok && !running && h('p', { class: 'muted small' }, `סנכרון אחרון: ${last.stats.added} עסקאות חדשות, ${last.stats.updated} עודכנו`),
    h('p', { class: 'muted small' }, `עודכן לאחרונה: ${c.lastSyncAt ? new Date(c.lastSyncAt).toLocaleString('he-IL', { dateStyle: 'short', timeStyle: 'short' }) : 'עוד לא סונכרן'}`),
    accounts.length > 0 && h('ul', { class: 'list' }, accounts.map(a => h('li', { class: 'list-row' },
      h('span', { class: 'list-main' }, h('span', {}, a.name), h('span', { class: 'muted small' }, `••${a.masked}`)),
      h('span', { class: 'list-amount' }, a.type === 'card' ? money(-(a.balance || 0)) : money(a.balance), h('span', { class: 'muted small' }, a.type === 'card' ? 'חיוב הבא' : 'יתרה'))))),
    h('div', { class: 'row-actions' },
      c.status === 'needs_attention'
        ? h('button', { type: 'button', class: 'btn primary', onclick: () => openEdit(ctx, c) }, 'עדכון פרטי התחברות')
        : h('button', { type: 'button', class: 'btn primary', disabled: running || queued || Boolean(sync.running), onclick: () => syncNow(ctx, { id: c.id }) }, running ? 'מסנכרן…' : '🔄 סנכרון עכשיו'),
      h('details', { class: 'section' }, h('summary', {}, 'עוד אפשרויות'),
        h('button', { type: 'button', class: 'btn', onclick: () => openEdit(ctx, c) }, 'עריכת שם ופרטי התחברות'),
        h('button', { type: 'button', class: 'btn danger', disabled: running, onclick: () => confirmDelete(ctx, c) }, 'הסרת החיבור וכל הנתונים שלו'))));
}

export async function syncNow(ctx, body) {
  try {
    const r = await api('sync', { method: 'POST', body });
    if (r.queued.length) toast(r.queued.length > 1 ? `מסנכרן ${r.queued.length} חשבונות…` : 'הסנכרון התחיל');
    else if (r.skipped.length) toast(SKIP_TEXT[r.skipped[0].reason] || 'לא היה מה לסנכרן');
  } catch (err) {
    toast(messageFor(err));
  }
  ctx.refresh({ keepScroll: true });
}

function credentialFields(provider, { optional = false } = {}) {
  return provider.fields.map(f => {
    const id = `cred-${f.key}`;
    const input = h('input', {
      id, name: f.key, required: !optional,
      type: f.type === 'password' ? 'password' : 'text',
      inputmode: f.type === 'numeric' ? 'numeric' : null,
      autocomplete: f.type === 'password' ? 'new-password' : 'off',
      autocapitalize: 'off', spellcheck: 'false', maxlength: 100,
    });
    return { key: f.key, input, el: [h('label', { for: id }, f.label), input] };
  });
}

async function openAdd(ctx) {
  let list;
  try {
    list = await api('providers');
  } catch (err) {
    return toast(messageFor(err));
  }
  const body = h('div', {});
  const pick = h('div', { class: 'provider-grid' }, list.filter(p => p.primary).map(p =>
    h('button', { type: 'button', class: 'provider-option', onclick: () => showForm(p) },
      h('span', { 'aria-hidden': 'true' }, p.kind === 'bank' ? '🏦' : '💳'), h('span', {}, p.name))));
  const others = h('select', { id: 'other-provider', 'aria-label': 'בנק או כרטיס אחר' },
    h('option', { value: '' }, 'בנק או כרטיס אחר…'),
    list.filter(p => !p.primary).map(p => h('option', { value: p.id }, p.name)));
  others.addEventListener('change', () => others.value && showForm(list.find(p => p.id === others.value)));
  body.append(h('p', { class: 'hint' }, 'בחר את הבנק או חברת האשראי:'), pick, others);
  const sheet = openSheet('הוספת חשבון', body);

  function showForm(p) {
    const name = h('input', { id: 'conn-name', type: 'text', maxlength: 40, value: p.name });
    const fields = credentialFields(p);
    const error = h('p', { class: 'error', role: 'alert' });
    const save = h('button', { type: 'submit', class: 'btn primary' }, 'שמירה וסנכרון ראשון');
    const form = h('form', { novalidate: true, autocomplete: 'off' },
      h('p', { class: 'hint' }, `אותם פרטים שבהם אתה נכנס לאתר של ${p.name}.`),
      fields.map(f => f.el),
      h('label', { for: 'conn-name' }, 'שם לתצוגה'), name,
      h('p', { class: 'muted small' }, '🔒 הפרטים נשמרים מוצפנים רק בטלפון הזה ונפתחים רק בזמן הסנכרון. הם לא נשלחים לשום מקום מלבד האתר הרשמי.'),
      error, save);
    form.addEventListener('submit', async e => {
      e.preventDefault();
      const credentials = Object.fromEntries(fields.map(f => [f.key, f.input.value]));
      if (Object.values(credentials).some(v => !v.trim())) return (error.textContent = 'יש למלא את כל השדות.');
      save.disabled = true;
      error.textContent = '';
      try {
        const { id } = await api('connections', { method: 'POST', body: { provider: p.id, displayName: name.value, credentials } });
        fields.forEach(f => { f.input.value = ''; });
        sheet.close();
        await syncNow(ctx, { id });
      } catch (err) {
        error.textContent = messageFor(err);
        save.disabled = false;
      }
    });
    body.replaceChildren(form);
    fields[0].input.focus();
  }
}

async function openEdit(ctx, c) {
  const list = await api('providers');
  const p = list.find(x => x.id === c.provider);
  const name = h('input', { id: 'conn-name', type: 'text', maxlength: 40, value: c.name });
  const fields = credentialFields(p, { optional: true });
  const error = h('p', { class: 'error', role: 'alert' });
  const form = h('form', { novalidate: true, autocomplete: 'off' },
    h('label', { for: 'conn-name' }, 'שם לתצוגה'), name,
    h('h3', { class: 'field-title' }, 'פרטי התחברות חדשים'),
    h('p', { class: 'muted small' }, 'להשאיר ריק אם לא השתנו. אם ממלאים, יש למלא את כל השדות.'),
    fields.map(f => f.el),
    error,
    h('button', { type: 'submit', class: 'btn primary' }, 'שמירה'));
  const sheet = openSheet(`עריכת ${c.name}`, form);
  form.addEventListener('submit', async e => {
    e.preventDefault();
    const values = Object.fromEntries(fields.map(f => [f.key, f.input.value]));
    const filled = Object.values(values).filter(v => v.trim()).length;
    if (filled && filled < fields.length) return (error.textContent = 'כדי לעדכן פרטי התחברות יש למלא את כל השדות.');
    try {
      await api('connections/update', { method: 'POST', body: { id: c.id, displayName: name.value, ...(filled ? { credentials: values } : {}) } });
      fields.forEach(f => { f.input.value = ''; });
      sheet.close();
      toast(filled ? 'פרטי ההתחברות עודכנו' : 'נשמר');
      ctx.refresh({ keepScroll: true });
    } catch (err) {
      error.textContent = messageFor(err);
    }
  });
}

function confirmDelete(ctx, c) {
  const confirmBtn = h('button', { type: 'button', class: 'btn danger' }, 'כן, להסיר');
  const sheet = openSheet('הסרת חיבור', h('div', {},
    h('p', {}, `להסיר את ${c.name}? כל העסקאות והחשבונות שלו יימחקו מהטלפון, יחד עם פרטי ההתחברות.`),
    confirmBtn,
    h('button', { type: 'button', class: 'btn', onclick: () => sheet.close() }, 'ביטול')));
  confirmBtn.addEventListener('click', async () => {
    try {
      await api('connections/delete', { method: 'POST', body: { id: c.id } });
      sheet.close();
      toast('החיבור הוסר');
      ctx.refresh();
    } catch (err) {
      toast(messageFor(err));
    }
  });
}

async function renderDemo(ctx) {
  const { accounts } = await api('accounts');
  return [
    h('div', { class: 'notice' },
      h('p', {}, 'במצב הדגמה מוצגים חשבונות לדוגמה. כדי לחבר את החשבונות האמיתיים שלך, יש לכבות את מצב ההדגמה.'),
      h('button', { type: 'button', class: 'btn primary', onclick: async () => {
        await api('settings/demo', { method: 'POST', body: { enabled: false } });
        ctx.setDemo(false);
        ctx.refresh();
      } }, 'כיבוי מצב הדגמה')),
    card(cardTitle('חשבונות לדוגמה'),
      h('ul', { class: 'list' }, accounts.map(a => h('li', { class: 'list-row' },
        h('span', { class: 'list-main' }, h('span', {}, a.name), h('span', { class: 'muted small' }, `••${a.masked}`)),
        h('span', { class: 'list-amount' }, a.type === 'card' ? money(-a.balance) : money(a.balance)))))),
  ];
}
