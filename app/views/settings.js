import { api, session, messageFor } from '../api.js';
import { h, card, cardTitle, toast } from '../ui.js';

export const title = 'הגדרות';
export const back = 'more';

export async function render(ctx) {
  const info = await api('info');

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
    card(cardTitle('מצב הדגמה'),
      h('label', { class: 'switch-row', for: 'demo-toggle' },
        h('span', {}, h('span', {}, 'הצגת נתונים לדוגמה'), h('span', { class: 'muted small' }, 'נתונים מומצאים בלבד. לא נשמרים ולא מתערבבים עם הנתונים האמיתיים.')),
        demo)),
    card(cardTitle('אבטחה'),
      h('p', { class: 'muted' }, `נעילה אוטומטית אחרי ${info.idleMinutes} דקות ללא שימוש.`),
      h('button', { type: 'button', class: 'btn', onclick: () => ctx.lock() }, '🔒 נעילה עכשיו'),
      h('details', { class: 'section' }, h('summary', {}, 'החלפת סיסמת מאסטר'), pwForm)),
    card(cardTitle('נתונים'),
      exportBtn,
      h('p', { class: 'muted small' }, 'גיבוי ושחזור מוצפנים, ניהול קטגוריות וחוקים ומחיקת נתונים יתווספו בשלבים 4–5.')),
    h('p', { class: 'muted small center' }, `Balancer · מבנה נתונים גרסה ${info.schemaVersion}`),
  ];
}
