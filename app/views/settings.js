import { api, session, messageFor } from '../api.js';
import { h, card, cardTitle, toast } from '../ui.js';
import { openBalancePicker } from './prefs.js';
import { downloadBackup, restoreBackup } from '../backup.js';

export const title = 'הגדרות';
export const back = 'more';

export async function render(ctx) {
  const [info, prefs] = await Promise.all([api('info'), api('prefs')]);

  const cycle = h('select', { id: 'cycle-day' }, Array.from({ length: 28 }, (_, i) => i + 1)
    .map(d => h('option', { value: d, selected: d === prefs.cycleDay }, d === 1 ? '1 בחודש (חודש קלנדרי)' : `${d} בחודש`)));
  cycle.addEventListener('change', async () => {
    cycle.disabled = true;
    try {
      const r = await api('prefs', { method: 'POST', body: { cycleDay: Number(cycle.value) } });
      ctx.setCycleDay(r.cycleDay);
      toast(r.cycleDay === 1 ? 'החודש מתחיל ב-1 לחודש' : `החודש מתחיל ב-${r.cycleDay} ומסתיים ב-${r.cycleDay - 1} בחודש הבא`);
    } catch (err) {
      cycle.value = String(prefs.cycleDay);
      toast(messageFor(err));
    } finally {
      cycle.disabled = false;
    }
  });
  const balanceSummary = () => {
    const inc = prefs.bankAccounts.filter(a => a.included).length;
    return prefs.bankAccounts.length ? `${inc} מתוך ${prefs.bankAccounts.length} חשבונות בנק` : 'אין עדיין חשבונות בנק';
  };

  const demo = h('input', { type: 'checkbox', id: 'demo-toggle', role: 'switch', checked: info.demo });
  demo.addEventListener('change', async () => {
    demo.disabled = true;
    try {
      await api('settings/demo', { method: 'POST', body: { enabled: demo.checked } });
      toast(demo.checked ? 'מצב הדגמה הופעל' : 'מצב הדגמה כובה');
      ctx.setDemo(demo.checked);
    } catch (err) {
      demo.checked = !demo.checked;
      toast(messageFor(err));
    } finally {
      demo.disabled = false;
    }
  });

  // Auto-lock
  const idle = h('select', { id: 'idle-minutes' }, prefs.idleChoices.map(m => h('option', { value: m, selected: m === prefs.idleMinutes }, m === 1 ? 'דקה' : `${m} דקות`)));
  idle.addEventListener('change', async () => {
    idle.disabled = true;
    try {
      await api('prefs', { method: 'POST', body: { idleMinutes: Number(idle.value) } });
      toast('נשמר');
    } catch (err) {
      idle.value = String(prefs.idleMinutes);
      toast(messageFor(err));
    } finally {
      idle.disabled = false;
    }
  });

  // Encrypted backup
  const backupBtn = h('button', { type: 'button', class: 'btn primary' }, '💾 הורדת גיבוי מוצפן');
  backupBtn.addEventListener('click', async () => {
    backupBtn.disabled = true;
    try {
      await downloadBackup();
      toast('הגיבוי ירד לתיקיית ההורדות');
    } catch (err) {
      toast(messageFor(err));
    } finally {
      backupBtn.disabled = false;
    }
  });
  const restoreFile = h('input', { id: 'restore-file-s', type: 'file', accept: '.json,application/json' });
  const restorePw = h('input', { id: 'restore-pw-s', type: 'password', autocomplete: 'current-password' });
  const restoreError = h('p', { class: 'error', role: 'alert' });
  const restoreForm = h('form', { novalidate: true },
    h('p', { class: 'muted small' }, 'השחזור מחליף את כל הנתונים שבטלפון עכשיו בנתונים שבגיבוי. סיסמת המאסטר תהיה זו שהייתה בשימוש כשהגיבוי נוצר.'),
    h('label', { for: 'restore-file-s' }, 'קובץ גיבוי'), restoreFile,
    h('label', { for: 'restore-pw-s' }, 'סיסמת המאסטר של הגיבוי'), restorePw,
    restoreError,
    h('button', { type: 'submit', class: 'btn danger' }, 'שחזור והחלפת הנתונים'));
  restoreForm.addEventListener('submit', async e => {
    e.preventDefault();
    restoreError.textContent = '';
    if (!restoreFile.files[0]) return (restoreError.textContent = 'יש לבחור קובץ גיבוי.');
    if (!confirm('להחליף את כל הנתונים שבטלפון בנתונים מהגיבוי? מומלץ להוריד קודם גיבוי של המצב הנוכחי.')) return;
    const btn = restoreForm.querySelector('button[type=submit]');
    btn.disabled = true;
    try {
      session.token = await restoreBackup(restoreFile.files[0], restorePw.value);
      toast('הנתונים שוחזרו');
      location.hash = '#/home';
      location.reload();
    } catch (err) {
      restoreError.textContent = messageFor(err);
      btn.disabled = false;
    }
  });

  // Delete everything
  const wipePw = h('input', { id: 'wipe-pw', type: 'password', autocomplete: 'current-password' });
  const wipeError = h('p', { class: 'error', role: 'alert' });
  const wipeForm = h('form', { novalidate: true },
    h('p', { class: 'muted small' }, 'מוחק מהטלפון את כל העסקאות, החשבונות, פרטי ההתחברות לבנקים והגדרות. אי אפשר לבטל. אחרי המחיקה תתבקש ליצור סיסמת מאסטר חדשה (או לשחזר מגיבוי).'),
    h('label', { for: 'wipe-pw' }, 'סיסמת מאסטר לאישור'), wipePw,
    wipeError,
    h('button', { type: 'submit', class: 'btn danger' }, '🗑️ מחיקת כל הנתונים'));
  wipeForm.addEventListener('submit', async e => {
    e.preventDefault();
    wipeError.textContent = '';
    if (!wipePw.value) return (wipeError.textContent = 'יש להזין את סיסמת המאסטר.');
    if (!confirm('למחוק את כל הנתונים מהטלפון? אי אפשר לבטל את זה.')) return;
    if (!confirm('בטוח? אם אין לך גיבוי, הנתונים יאבדו לגמרי.')) return;
    const btn = wipeForm.querySelector('button[type=submit]');
    btn.disabled = true;
    try {
      await api('wipe', { method: 'POST', body: { password: wipePw.value } });
      session.token = null;
      location.hash = '';
      location.reload();
    } catch (err) {
      wipeError.textContent = messageFor(err);
      btn.disabled = false;
    }
  });

  const exportBtn = h('button', { type: 'button', class: 'btn' }, 'ייצוא עסקאות ל-CSV');
  exportBtn.addEventListener('click', async () => {
    exportBtn.disabled = true;
    try {
      const res = await fetch('/api/export.csv', { headers: { Authorization: `Bearer ${session.token}` }, cache: 'no-store' });
      if (!res.ok) throw Object.assign(new Error(), { code: res.status === 401 ? 'locked' : 'internal' });
      const url = URL.createObjectURL(await res.blob());
      const a = h('a', { href: url, download: `balancer-${info.today}${info.demo ? '-demo' : ''}.csv` });
      document.body.append(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (err) {
      toast(messageFor(err.code ? err : { code: 'network' }));
    } finally {
      exportBtn.disabled = false;
    }
  });

  const pwOld = h('input', { id: 'pw-old', type: 'password', autocomplete: 'current-password', required: true });
  const pwNew = h('input', { id: 'pw-new', type: 'password', autocomplete: 'new-password', minlength: 8, required: true });
  const pwConfirm = h('input', { id: 'pw-confirm', type: 'password', autocomplete: 'new-password', minlength: 8, required: true });
  const pwError = h('p', { class: 'error', role: 'alert' });
  const pwForm = h('form', { novalidate: true },
    h('label', { for: 'pw-old' }, 'סיסמה נוכחית'), pwOld,
    h('label', { for: 'pw-new' }, 'סיסמה חדשה (לפחות 8 תווים)'), pwNew,
    h('label', { for: 'pw-confirm' }, 'אימות סיסמה חדשה'), pwConfirm,
    pwError,
    h('button', { type: 'submit', class: 'btn primary' }, 'החלפת סיסמה'));
  pwForm.addEventListener('submit', async e => {
    e.preventDefault();
    pwError.textContent = '';
    if ([...pwNew.value].length < 8) return (pwError.textContent = messageFor({ code: 'weak_password' }));
    if (pwNew.value !== pwConfirm.value) return (pwError.textContent = 'הסיסמאות החדשות לא זהות.');
    const btn = pwForm.querySelector('button');
    btn.disabled = true;
    try {
      await api('password', { method: 'POST', body: { oldPassword: pwOld.value, newPassword: pwNew.value } });
      pwForm.reset();
      toast('הסיסמה הוחלפה');
    } catch (err) {
      pwError.textContent = messageFor(err);
    } finally {
      btn.disabled = false;
    }
  });

  return [
    card(cardTitle('חודש התקציב'),
      h('label', { for: 'cycle-day' }, 'החודש מתחיל ב-'), cycle,
      h('p', { class: 'muted small' }, 'כל הסיכומים, התקציב, המגמות וההתראות יחושבו לפי התאריך הזה. למשל 10: מה-10 בחודש עד ה-9 בחודש הבא.')),
    card(cardTitle('יתרה בעו"ש'),
      h('p', { class: 'muted' }, `מחושבת לפי ${balanceSummary()}.`),
      prefs.bankAccounts.length > 0 && h('button', { type: 'button', class: 'btn', onclick: () => openBalancePicker(() => ctx.refresh({ keepScroll: true })) }, 'בחירת חשבונות')),
    card(cardTitle('מצב הדגמה'),
      h('label', { class: 'switch-row', for: 'demo-toggle' },
        h('span', {}, h('span', {}, 'הצגת נתונים לדוגמה'), h('span', { class: 'muted small' }, 'נתונים מומצאים בלבד. לא נשמרים ולא מתערבבים עם הנתונים האמיתיים.')),
        demo)),
    card(cardTitle('גיבוי ושחזור'),
      h('p', { class: 'muted small' }, 'קובץ אחד עם כל הנתונים, מוצפן בסיסמת המאסטר. כדאי לגבות פעם בשבוע ולשמור את הקובץ מחוץ לטלפון (Google Drive, מייל לעצמך). בלי הסיסמה אי אפשר לפתוח אותו.'),
      backupBtn,
      h('details', { class: 'section' }, h('summary', {}, 'שחזור מגיבוי'), restoreForm)),
    card(cardTitle('אבטחה'),
      h('label', { for: 'idle-minutes' }, 'נעילה אוטומטית אחרי חוסר שימוש של'), idle,
      h('button', { type: 'button', class: 'btn', onclick: () => ctx.lock() }, '🔒 נעילה עכשיו'),
      h('details', { class: 'section' }, h('summary', {}, 'החלפת סיסמת מאסטר'), pwForm)),
    card(cardTitle('נתונים'),
      exportBtn,
      h('button', { type: 'button', class: 'btn', onclick: () => ctx.navigate('categories') }, '🏷️ קטגוריות וחוקים'),
      h('details', { class: 'section danger-zone' }, h('summary', {}, 'מחיקת כל הנתונים'), wipeForm)),
    h('p', { class: 'muted small center' }, `Balancer · מבנה נתונים גרסה ${info.schemaVersion}`),
  ];
}
