// Talks only to the local server (same origin). The session token lives in sessionStorage,
// so it is gone when the tab closes.
const TOKEN_KEY = 'balancer.token';

export class ApiError extends Error {
  constructor(code, data = {}) {
    super(code);
    this.code = code;
    this.data = data;
  }
}

export const session = {
  get token() { try { return sessionStorage.getItem(TOKEN_KEY); } catch { return null; } },
  set token(v) { try { v ? sessionStorage.setItem(TOKEN_KEY, v) : sessionStorage.removeItem(TOKEN_KEY); } catch { /* private mode */ } },
};

export async function api(path, { method = 'GET', body } = {}) {
  const headers = {};
  if (session.token) headers.Authorization = `Bearer ${session.token}`;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  let res;
  try {
    res = await fetch(`/api/${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), cache: 'no-store' });
  } catch {
    throw new ApiError('network');
  }
  let data = {};
  try { data = await res.json(); } catch { /* empty body */ }
  if (!res.ok) throw new ApiError(data.error || `http_${res.status}`, data);
  return data;
}

// Hebrew messages for the user; codes stay in English for the dev logs
export function messageFor(err) {
  const wait = err.data?.retryAfterSec;
  switch (err.code) {
    case 'network': return 'אין חיבור לשרת המקומי. ודא ש-Balancer פועל ב-Termux (scripts/start.sh) ונסה שוב.';
    case 'wrong_password': return wait > 1 ? `סיסמה שגויה. אפשר לנסות שוב בעוד ${formatWait(wait)}.` : 'סיסמה שגויה.';
    case 'too_many_attempts': return `יותר מדי ניסיונות. אפשר לנסות שוב בעוד ${formatWait(wait)}.`;
    case 'busy': return 'בודק סיסמה, רגע…';
    case 'weak_password': return 'הסיסמה קצרה מדי. נדרשים לפחות 8 תווים.';
    case 'already_initialized': return 'כבר קיימת כספת בטלפון הזה.';
    case 'demo_on': return 'מצב הדגמה פעיל. יש לכבות אותו בהגדרות כדי לחבר או לסנכרן חשבונות אמיתיים.';
    case 'bad_credentials': return 'יש למלא את כל פרטי ההתחברות.';
    case 'sync_running': return 'הסנכרון רץ כרגע. אפשר לנסות שוב כשיסתיים.';
    case 'bad_split': return 'סכומי הפיצול גבוהים מסכום העסקה, או שחסר סכום.';
    case 'not_found': return 'הפריט לא נמצא. ייתכן שהוא נמחק או השתנה בסנכרון.';
    case 'bad_request': return 'הנתונים שנשלחו לא תקינים.';
    case 'name_taken': return 'כבר קיימת קטגוריה בשם הזה.';
    case 'bad_rule': return 'החוק לא תקין. יש למלא טקסט לחיפוש ולבחור קטגוריה.';
    case 'corrupt': return 'קובץ הנתונים פגום או חסר. אפשר לשחזר מגיבוי (יתווסף בהמשך).';
    case 'unauthorized':
    case 'locked': return 'הכספת ננעלה. יש להזין סיסמה שוב.';
    default: return 'אירעה שגיאה לא צפויה. נסה שוב.';
  }
}

function formatWait(sec = 0) {
  if (sec < 60) return `${sec} שניות`;
  const min = Math.ceil(sec / 60);
  return min === 1 ? 'דקה' : `${min} דקות`;
}
