// Shared preference sheets: which bank accounts make up the balance.
import { api, messageFor } from '../api.js';
import { h, money, openSheet, toast, accountLabel } from '../ui.js';

export async function openBalancePicker(onSaved) {
  let p;
  try {
    p = await api('prefs');
  } catch (err) {
    return toast(messageFor(err));
  }
  if (!p.bankAccounts.length) return toast('אין עדיין חשבונות בנק');
  const boxes = p.bankAccounts.map((a, i) => {
    const box = h('input', { type: 'checkbox', id: `bal-${i}`, value: a.id, checked: a.included });
    return h('label', { class: 'check balance-pick', for: `bal-${i}` }, box,
      h('span', { class: 'list-main' }, h('span', {}, accountLabel(a.name, a.masked)), h('span', { class: 'muted small' }, money(a.balance))));
  });
  const error = h('p', { class: 'error', role: 'alert' });
  const save = h('button', { type: 'submit', class: 'btn primary' }, 'שמירה');
  const form = h('form', { novalidate: true },
    h('p', { class: 'muted small' }, 'היתרה בעו"ש, התחזית וההתראות יחושבו רק לפי החשבונות המסומנים.'),
    boxes, error, save);
  const sheet = openSheet('חשבונות ביתרת העו"ש', form);
  form.addEventListener('submit', async e => {
    e.preventDefault();
    const ids = [...form.querySelectorAll('input[type=checkbox]:checked')].map(b => b.value);
    if (!ids.length) return (error.textContent = 'יש לבחור לפחות חשבון אחד.');
    save.disabled = true;
    try {
      // All of them = no filter, so accounts added later are included automatically
      await api('prefs', { method: 'POST', body: { balanceAccounts: ids.length === p.bankAccounts.length ? [] : ids } });
      sheet.close();
      toast('נשמר');
      onSaved?.();
    } catch (err) {
      error.textContent = messageFor(err);
      save.disabled = false;
    }
  });
}
