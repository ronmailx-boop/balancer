// Institutions offered in the UI. Fields come from the library, labels are ours (Hebrew).
import { SCRAPERS } from 'israeli-bank-scrapers-core';

// First the user's own institutions, then the rest the library supports.
// One Zero is left out: it needs an SMS code flow, and the user chose no SMS handling.
const ORDER = ['leumi', 'visaCal', 'max', 'hapoalim', 'discount', 'mizrahi', 'isracard', 'amex', 'beinleumi',
  'mercantile', 'otsarHahayal', 'union', 'massad', 'yahav', 'beyahadBishvilha', 'behatsdaa', 'pagi'];

const META = {
  leumi: ['bank', 'בנק לאומי'], hapoalim: ['bank', 'בנק הפועלים'], discount: ['bank', 'בנק דיסקונט'],
  mizrahi: ['bank', 'מזרחי טפחות'], beinleumi: ['bank', 'הבינלאומי'], mercantile: ['bank', 'מרכנתיל'],
  otsarHahayal: ['bank', 'אוצר החייל'], union: ['bank', 'בנק איגוד'], massad: ['bank', 'בנק מסד'],
  yahav: ['bank', 'בנק יהב'], pagi: ['bank', 'בנק פאגי'],
  visaCal: ['card', 'כאל (ויזה כאל)'], max: ['card', 'מקס'], isracard: ['card', 'ישראכרט'], amex: ['card', 'אמריקן אקספרס'],
  beyahadBishvilha: ['card', 'ביחד בשבילך'], behatsdaa: ['card', 'בהצדעה'],
};

const FIELD = {
  username: ['שם משתמש', 'text'],
  userCode: ['קוד משתמש', 'text'],
  password: ['סיסמה', 'password'],
  id: ['תעודת זהות', 'numeric'],
  nationalID: ['תעודת זהות', 'numeric'],
  num: ['קוד מזהה', 'text'],
  card6Digits: ['6 ספרות אחרונות של הכרטיס', 'numeric'],
};

export function providers() {
  return ORDER.filter(id => SCRAPERS[id]).map(id => {
    const fields = SCRAPERS[id].loginFields.filter(f => FIELD[f]);
    return {
      id,
      kind: META[id]?.[0] ?? 'bank',
      name: META[id]?.[1] ?? SCRAPERS[id].name,
      fields: fields.map(key => ({ key, label: FIELD[key][0], type: FIELD[key][1] })),
      primary: ['leumi', 'visaCal', 'max'].includes(id),
    };
  });
}

export function providerById(id) {
  return providers().find(p => p.id === id) || null;
}
