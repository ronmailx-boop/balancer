// Recorded-shape fake scraper outputs (invented data, never real).
const iso = day => `${day}T09:00:00.000Z`; // midday UTC: the same calendar day in Israel all year

export const leumiFirst = {
  success: true,
  accounts: [{
    accountNumber: '123-456789/01',
    balance: 12345.67,
    txns: [
      { type: 'normal', identifier: 9001, date: iso('2026-09-08'), processedDate: iso('2026-09-08'), originalAmount: 18500, originalCurrency: 'ILS', chargedAmount: 18500, description: 'משכורת - חברה בדויה', status: 'completed' },
      { type: 'normal', identifier: 9002, date: iso('2026-09-30'), processedDate: iso('2026-09-30'), originalAmount: -5200, originalCurrency: 'ILS', chargedAmount: -5200, description: 'הוראת קבע שכר דירה', status: 'completed' },
      { type: 'normal', date: iso('2026-10-01'), processedDate: iso('2026-10-01'), originalAmount: -3152.2, originalCurrency: 'ILS', chargedAmount: -3152.2, description: 'כאל חיוב כרטיס', status: 'completed' },
    ],
  }],
};

export const maxFirst = {
  success: true,
  accounts: [{
    accountNumber: '5532',
    txns: [
      { type: 'normal', date: iso('2026-10-04'), processedDate: iso('2026-11-09'), originalAmount: -42, originalCurrency: 'ILS', chargedAmount: -42, description: 'קפה גרג', status: 'completed' },
      { type: 'normal', date: iso('2026-10-04'), processedDate: iso('2026-11-09'), originalAmount: -42, originalCurrency: 'ILS', chargedAmount: -42, description: 'קפה גרג', status: 'completed' },
      { type: 'installments', date: iso('2026-07-13'), processedDate: iso('2026-11-09'), originalAmount: -3600, originalCurrency: 'ILS', chargedAmount: -300, description: 'איקאה נתניה', status: 'completed', installments: { number: 4, total: 12 } },
      { type: 'normal', date: iso('2026-10-08'), processedDate: iso('2026-11-09'), originalAmount: -30, originalCurrency: 'USD', chargedAmount: -112.5, description: 'ALIEXPRESS', status: 'completed' },
      { type: 'normal', date: iso('2026-10-09'), processedDate: iso('2026-11-09'), originalAmount: -250, originalCurrency: 'ILS', chargedAmount: -250, description: 'שופרסל דיל', status: 'pending' },
    ],
  }],
};

// Next scrape: the pending Shufersal posted with a slightly different amount, a new purchase appeared
export const maxSecond = {
  success: true,
  accounts: [{
    accountNumber: '5532',
    txns: [
      ...maxFirst.accounts[0].txns.slice(0, 4),
      { type: 'normal', identifier: 'A77', date: iso('2026-10-09'), processedDate: iso('2026-11-09'), originalAmount: -251.3, originalCurrency: 'ILS', chargedAmount: -251.3, description: 'שופרסל דיל', status: 'completed' },
      { type: 'normal', date: iso('2026-10-11'), processedDate: iso('2026-11-09'), originalAmount: -60, originalCurrency: 'ILS', chargedAmount: -60, description: 'פז אפליקציה', status: 'pending' },
    ],
  }],
};
