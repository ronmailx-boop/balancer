// Demo Mode: realistic fake Hebrew data for one household. Deterministic for a given "today".
// Never mixed with real data: it is written only into a separate in-memory database.
import { seedCategories } from './categories.js';

// Small seeded PRNG (mulberry32)
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const pad = n => String(n).padStart(2, '0');
export const isoDate = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const dateOf = (y, m, day) => new Date(y, m, Math.min(day, new Date(y, m + 1, 0).getDate()));
const round = (n, step = 0.1) => Math.round(n / step) * step;
const money = n => Math.round(n * 100) / 100;

const ACCOUNTS = [
  { id: 'demo-leumi', connection: 'demo-conn-leumi', provider: 'leumi', kind: 'bank', name: 'עו"ש לאומי', masked: '4821', type: 'checking' },
  { id: 'demo-max', connection: 'demo-conn-max', provider: 'max', kind: 'card', name: 'מקס', masked: '5532', type: 'card', chargeDay: 10 },
  { id: 'demo-cal', connection: 'demo-conn-cal', provider: 'visaCal', kind: 'card', name: 'כאל', masked: '7710', type: 'card', chargeDay: 2 },
];

// Variable spending patterns: [description, category, account, timesPerMonth, min, max]
const VARIABLE = [
  ['שופרסל דיל', 'groceries', 'demo-max', 4, 180, 620],
  ['רמי לוי שיווק השקמה', 'groceries', 'demo-cal', 2, 250, 700],
  ['AM:PM', 'groceries', 'demo-max', 3, 25, 90],
  ['פז אפליקציה', 'transport', 'demo-max', 2, 240, 360],
  ['סונול', 'transport', 'demo-cal', 1, 200, 320],
  ['פנגו חניה', 'transport', 'demo-max', 3, 8, 30],
  ['ארומה תל אביב', 'restaurants', 'demo-cal', 4, 28, 65],
  ['וולט', 'restaurants', 'demo-cal', 3, 70, 180],
  ['מסעדת השף הלבן', 'restaurants', 'demo-max', 1, 220, 480],
  ['סופר-פארם', 'health', 'demo-max', 2, 40, 220],
  ['זארה', 'shopping', 'demo-cal', 0.6, 150, 450],
  ['ALIEXPRESS', 'shopping', 'demo-cal', 1, 30, 140, 'USD'],
  ['סינמה סיטי', 'leisure', 'demo-max', 0.7, 80, 160],
  ['ACE', 'home', 'demo-max', 0.5, 60, 300],
  ['קפה גרג', 'restaurants', 'demo-max', 2, 22, 55],
];

// Fixed monthly charges on cards: [description, category, account, day, amount]
const SUBSCRIPTIONS = [
  ['NETFLIX.COM', 'subscriptions', 'demo-max', 5, 54.9],
  ['SPOTIFY', 'subscriptions', 'demo-cal', 12, 21.9],
  ['APPLE.COM/BILL', 'subscriptions', 'demo-cal', 18, 9.9],
  ['סלקום', 'communication', 'demo-max', 3, 59],
  ['הולמס פלייס', 'fitness', 'demo-cal', 1, 249],
  ['הראל ביטוח בריאות', 'insurance', 'demo-cal', 15, 189],
];

// Installment purchases: [description, category, account, monthsAgoStarted, total, payments, day]
const INSTALLMENTS = [
  ['איקאה נתניה', 'home', 'demo-max', 3, 3600, 12, 14],
  ['KSP מחשבים', 'shopping', 'demo-cal', 6, 4800, 10, 22],
];

export const DEMO_MONTHS = 7;

export function generateDemo(db, { today = new Date() } = {}) {
  const t0 = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const rand = rng(t0.getFullYear() * 10000 + (t0.getMonth() + 1) * 100);
  const between = (a, b) => a + (b - a) * rand();
  const todayIso = isoDate(t0);

  seedCategories(db);
  db.run('BEGIN');
  const conn = db.prepare("INSERT INTO connections (id, kind, provider, display_name, status, last_sync_at) VALUES (?, ?, ?, ?, 'ok', ?)");
  const acc = db.prepare('INSERT INTO accounts (id, connection_id, display_name, masked_number, type, balance, currency, updated_at) VALUES (?, ?, ?, ?, ?, 0, \'ILS\', ?)');
  const syncedAt = new Date(t0.getTime() + 7.5 * 3600 * 1000).toISOString();
  for (const a of ACCOUNTS) {
    conn.run([a.connection, a.kind, a.provider, a.name, syncedAt]);
    acc.run([a.id, a.connection, a.name, a.masked, a.type, syncedAt]);
  }
  conn.free();
  acc.free();

  const tx = db.prepare(`INSERT INTO transactions (id, account_id, date, processed_date, description, original_amount, original_currency,
    charged_amount, type, installment_number, installment_total, category_id, is_recurring, memo)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  let seq = 0;
  const cardTotals = {}; // `${accountId}|${YYYY-MM}` of purchase month -> total charged
  const add = ({ account, date, description, amount, category, type = 'normal', number = null, total = null,
    recurring = 0, currency = 'ILS', original = amount, processed = null, memo = null }) => {
    const iso = isoDate(date);
    if (iso > todayIso) return;
    // Purchases from the last 3 days are still pending on cards
    const daysAgo = (t0 - date) / 86400000;
    const isCard = account !== 'demo-leumi';
    const finalType = isCard && daysAgo < 3 && type === 'normal' ? 'pending' : type;
    tx.run([`demo-${++seq}`, account, iso, processed ? isoDate(processed) : null, description, money(original), currency,
      money(amount), finalType, number, total, category, recurring, memo]);
    if (isCard) {
      const key = `${account}|${iso.slice(0, 7)}`;
      cardTotals[key] = (cardTotals[key] || 0) + amount;
    }
  };

  const months = [];
  for (let i = DEMO_MONTHS - 1; i >= 0; i--) months.push(new Date(t0.getFullYear(), t0.getMonth() - i, 1));

  for (const m of months) {
    const y = m.getFullYear();
    const mo = m.getMonth();
    const days = new Date(y, mo + 1, 0).getDate();

    // Bank: salary, rent, bills, cash, a transfer
    add({ account: 'demo-leumi', date: dateOf(y, mo, 9), description: 'משכורת - טכנולוגיות בע"מ', amount: round(between(18200, 18900), 1), category: 'salary', recurring: 1 });
    add({ account: 'demo-leumi', date: dateOf(y, mo, 1), description: 'הוראת קבע - שכר דירה', amount: -5200, category: 'rent', recurring: 1 });
    if (mo % 2 === 0) {
      add({ account: 'demo-leumi', date: dateOf(y, mo, 6), description: 'עיריית תל אביב - ארנונה', amount: -round(between(760, 800), 1), category: 'utilities', recurring: 1 });
      add({ account: 'demo-leumi', date: dateOf(y, mo, 20), description: 'חברת החשמל', amount: -round(between(320, 560), 0.1), category: 'utilities', recurring: 1 });
    } else {
      add({ account: 'demo-leumi', date: dateOf(y, mo, 16), description: 'מי אביבים', amount: -round(between(140, 210), 0.1), category: 'utilities', recurring: 1 });
    }
    if (rand() < 0.7) add({ account: 'demo-leumi', date: dateOf(y, mo, 12 + Math.floor(rand() * 10)), description: 'משיכת מזומן כספומט', amount: -[200, 300, 500][Math.floor(rand() * 3)], category: 'cash' });
    if (rand() < 0.5) add({ account: 'demo-leumi', date: dateOf(y, mo, 25), description: 'העברה מ-ביט', amount: round(between(100, 450), 1), category: 'income_other' });
    add({ account: 'demo-leumi', date: dateOf(y, mo, 27), description: 'העברה לחיסכון', amount: -1000, category: 'transfers', recurring: 1 });

    // Cards: variable spending
    for (const [description, category, account, perMonth, min, max, currency] of VARIABLE) {
      const count = Math.floor(perMonth) + (rand() < perMonth % 1 ? 1 : 0);
      for (let k = 0; k < count; k++) {
        const day = 1 + Math.floor(rand() * days);
        const amount = round(between(min, max), 0.1);
        if (currency === 'USD') {
          const usd = Math.round(amount / 3.7 * 100) / 100;
          add({ account, date: dateOf(y, mo, day), description, amount: -amount, original: -usd, currency: 'USD', category });
        } else {
          add({ account, date: dateOf(y, mo, day), description, amount: -amount, category });
        }
      }
    }
    for (const [description, category, account, day, amount] of SUBSCRIPTIONS) {
      add({ account, date: dateOf(y, mo, day), description, amount: -amount, category, recurring: 1 });
    }
    // Installments: one payment per month, dated in the charge month
    for (const [description, category, account, startedAgo, total, payments, day] of INSTALLMENTS) {
      const start = new Date(t0.getFullYear(), t0.getMonth() - startedAgo, 1);
      const n = (y - start.getFullYear()) * 12 + (mo - start.getMonth()) + 1;
      if (n < 1 || n > payments) continue;
      add({
        account, date: dateOf(y, mo, day), processed: dateOf(y, mo, day), description, amount: -(total / payments),
        original: -total, category, type: 'installments', number: n, total: payments,
        memo: `תשלום ${n} מתוך ${payments}`,
      });
    }
    // Occasional gift
    if (rand() < 0.35) add({ account: 'demo-max', date: dateOf(y, mo, 1 + Math.floor(rand() * days)), description: 'מתנה - חנות צעצועים', amount: -round(between(120, 280), 1), category: 'gifts' });
  }

  // Bank debits for card bills: each card's purchases of month M are charged on its charge day in M+1
  for (const a of ACCOUNTS.filter(x => x.type === 'card')) {
    for (const m of months) {
      const total = cardTotals[`${a.id}|${isoDate(m).slice(0, 7)}`];
      if (!total) continue;
      const chargeDate = dateOf(m.getFullYear(), m.getMonth() + 1, a.chargeDay);
      add({ account: 'demo-leumi', date: chargeDate, description: `חיוב כרטיס ${a.name} ${a.masked}`, amount: total, category: 'card_payment', recurring: 1 });
    }
  }
  tx.free();

  // Balances: the bank balance results from an opening balance + all bank movements
  const bankSum = db.exec("SELECT COALESCE(SUM(charged_amount), 0) FROM transactions WHERE account_id = 'demo-leumi'")[0].values[0][0];
  db.run('UPDATE accounts SET balance = ? WHERE id = ?', [money(9500 + bankSum), 'demo-leumi']);

  // Upcoming card charges: purchases of the current month, charged next month
  const charge = db.prepare('INSERT INTO card_charges (account_id, charge_date, amount) VALUES (?, ?, ?)');
  for (const a of ACCOUNTS.filter(x => x.type === 'card')) {
    const thisMonth = isoDate(t0).slice(0, 7);
    const lastMonth = isoDate(new Date(t0.getFullYear(), t0.getMonth() - 1, 1)).slice(0, 7);
    // Last month's bill may still be ahead this month (e.g. charge day 10, today the 5th)
    const lastBill = dateOf(t0.getFullYear(), t0.getMonth(), a.chargeDay);
    if (isoDate(lastBill) > todayIso && cardTotals[`${a.id}|${lastMonth}`]) {
      charge.run([a.id, isoDate(lastBill), money(-cardTotals[`${a.id}|${lastMonth}`])]);
    }
    const nextBill = dateOf(t0.getFullYear(), t0.getMonth() + 1, a.chargeDay);
    const current = cardTotals[`${a.id}|${thisMonth}`] || 0;
    charge.run([a.id, isoDate(nextBill), money(-current)]);
    db.run('UPDATE accounts SET balance = ? WHERE id = ?', [money(current), a.id]);
  }
  charge.free();

  // Recurring items (Phase 4 detects these automatically; demo seeds them)
  const rec = db.prepare("INSERT INTO recurring_items (id, merchant, typical_amount, cadence, next_expected, status) VALUES (?, ?, ?, ?, ?, 'active')");
  const nextOn = day => {
    const d = dateOf(t0.getFullYear(), t0.getMonth(), day);
    return isoDate(isoDate(d) > todayIso ? d : dateOf(t0.getFullYear(), t0.getMonth() + 1, day));
  };
  rec.run(['demo-rec-salary', 'משכורת - טכנולוגיות בע"מ', 18500, 'monthly', nextOn(9)]);
  rec.run(['demo-rec-rent', 'הוראת קבע - שכר דירה', -5200, 'monthly', nextOn(1)]);
  rec.run(['demo-rec-savings', 'העברה לחיסכון', -1000, 'monthly', nextOn(27)]);
  rec.run(['demo-rec-arnona', 'עיריית תל אביב - ארנונה', -780, 'bimonthly', nextOn(6)]);
  SUBSCRIPTIONS.forEach(([description, , , day, amount], i) => rec.run([`demo-rec-sub-${i}`, description, -amount, 'monthly', nextOn(day)]));
  rec.free();

  // Budgets for every demo month
  const PLAN = { groceries: 3200, restaurants: 1100, transport: 1200, health: 300, shopping: 700, leisure: 250, home: 400, subscriptions: 400, communication: 60, fitness: 250, insurance: 190, utilities: 700, rent: 5200, gifts: 200, cash: 400 };
  const bud = db.prepare('INSERT INTO budgets (category_id, month, planned_amount) VALUES (?, ?, ?)');
  for (const m of months) for (const [cat, amount] of Object.entries(PLAN)) bud.run([cat, isoDate(m).slice(0, 7), amount]);
  bud.free();

  db.run("INSERT OR REPLACE INTO settings (key, value) VALUES ('demo_generated_for', ?)", [todayIso]);
  db.run('COMMIT');
}
