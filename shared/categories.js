// Default Hebrew categories and starter rules for common Israeli merchants.
// type: expense | income | transfer (moves money between own accounts, never counted) | ignore
export const DEFAULT_CATEGORIES = [
  { id: 'salary', name: 'משכורת', icon: '💼', type: 'income' },
  { id: 'income_other', name: 'הכנסות אחרות', icon: '💰', type: 'income' },

  { id: 'rent', name: 'שכר דירה ומשכנתא', icon: '🏠', type: 'expense', fixed: true },
  { id: 'utilities', name: 'חשבונות בית', icon: '💡', type: 'expense', fixed: true },
  { id: 'communication', name: 'תקשורת', icon: '📱', type: 'expense', fixed: true },
  { id: 'insurance', name: 'ביטוחים', icon: '🛡️', type: 'expense', fixed: true },
  { id: 'subscriptions', name: 'מנויים', icon: '📺', type: 'expense', fixed: true },
  { id: 'fitness', name: 'ספורט', icon: '🏋️', type: 'expense', fixed: true },
  { id: 'education', name: 'חינוך וחוגים', icon: '🎓', type: 'expense', fixed: true },

  { id: 'groceries', name: 'סופר', icon: '🛒', type: 'expense' },
  { id: 'restaurants', name: 'אוכל בחוץ', icon: '☕', type: 'expense' },
  { id: 'transport', name: 'דלק ותחבורה', icon: '⛽', type: 'expense' },
  { id: 'health', name: 'בריאות ופארם', icon: '💊', type: 'expense' },
  { id: 'shopping', name: 'קניות וביגוד', icon: '🛍️', type: 'expense' },
  { id: 'home', name: 'לבית', icon: '🛠️', type: 'expense' },
  { id: 'leisure', name: 'פנאי ובילוי', icon: '🎬', type: 'expense' },
  { id: 'gifts', name: 'מתנות ותרומות', icon: '🎁', type: 'expense' },
  { id: 'cash', name: 'משיכת מזומן', icon: '🏧', type: 'expense' },
  { id: 'misc', name: 'שונות', icon: '📦', type: 'expense' },

  { id: 'card_payment', name: 'חיוב כרטיס אשראי', icon: '💳', type: 'transfer' },
  { id: 'transfers', name: 'העברות בין חשבונות', icon: '🔁', type: 'transfer' },
];

// [match_type, pattern, category_id]; matched against the transaction description
export const DEFAULT_RULES = [
  ...['שופרסל', 'רמי לוי', 'יוחננוף', 'ויקטורי', 'מגה', 'אושר עד', 'טיב טעם', 'חצי חינם', 'יינות ביתן', 'AM:PM']
    .map(p => ['contains', p, 'groceries']),
  ...['פז', 'סונול', 'דלק', 'דור אלון', 'טן ', 'רב-קו', 'רב קו', 'גט טקסי', 'GETT', 'חניון', 'פנגו', 'סלופארק']
    .map(p => ['contains', p, 'transport']),
  ...['סופר-פארם', 'סופר פארם', 'BE ', 'מכבי', 'כללית', 'מאוחדת', 'לאומית', 'אופטיקה']
    .map(p => ['contains', p, 'health']),
  ...['NETFLIX', 'נטפליקס', 'SPOTIFY', 'ספוטיפיי', 'APPLE.COM', 'GOOGLE', 'דיסני', 'DISNEY', 'יס פלוס']
    .map(p => ['contains', p, 'subscriptions']),
  ['regex', '\\b(YES|HOT)\\b', 'subscriptions'],
  ...['פרטנר', 'סלקום', 'פלאפון', 'בזק', 'הוט מובייל', 'גולן טלקום', 'רמי לוי תקשורת']
    .map(p => ['contains', p, 'communication']),
  ...['חברת החשמל', 'חשמל', 'תאגיד', 'מי אביבים', 'מי שבע', 'מי כרמל', 'הגיחון', 'מי נתניה', 'מי רעננה', 'ארנונה', 'עירייה', 'עיריית', 'סופרגז', 'אמישראגז']
    .map(p => ['contains', p, 'utilities']),
  ...['ארומה', 'קפה', 'מקדונלד', 'וולט', 'WOLT', 'תן ביס', '10BIS', 'פיצה', 'בורגר', 'מסעדת', 'גרג']
    .map(p => ['contains', p, 'restaurants']),
  ...['זארה', 'ZARA', 'H&M', 'קסטרו', 'פוקס', 'ALIEXPRESS', 'עלי אקספרס', 'AMAZON', 'אמזון', 'KSP', 'באג', 'איביי', 'SHEIN']
    .map(p => ['contains', p, 'shopping']),
  ...['איקאה', 'IKEA', 'ACE', 'הום סנטר', 'טמבור']
    .map(p => ['contains', p, 'home']),
  ...['הראל', 'מגדל', 'כלל ביטוח', 'הפניקס', 'מנורה', 'איילון', 'ביטוח']
    .map(p => ['contains', p, 'insurance']),
  ...['הולמס פלייס', 'הולמס', 'GO ACTIVE', 'ספייס']
    .map(p => ['contains', p, 'fitness']),
  ...['סינמה סיטי', 'יס פלאנט', 'לב סינמה', 'הופעה', 'תיאטרון', 'כרטיסים']
    .map(p => ['contains', p, 'leisure']),
  ['contains', 'משכורת', 'salary'],
  ['contains', 'משיכת מזומן', 'cash'],
  ['contains', 'כספומט', 'cash'],
  ...['מקס איט', 'ישראכרט', 'כאל', 'ויזה', 'לאומי קארד', 'אמריקן אקספרס', 'חיוב כרטיס']
    .map(p => ['contains', p, 'card_payment']),
  ['contains', 'שכר דירה', 'rent'],
  ['contains', 'משכנתא', 'rent'],
];

export function seedCategories(db) {
  const insert = db.prepare('INSERT OR IGNORE INTO categories (id, name, icon, type, is_fixed, sort_order) VALUES (?, ?, ?, ?, ?, ?)');
  DEFAULT_CATEGORIES.forEach((c, i) => insert.run([c.id, c.name, c.icon, c.type, c.fixed ? 1 : 0, i]));
  insert.free();
  const rule = db.prepare("INSERT OR IGNORE INTO category_rules (id, match_type, pattern, category_id, priority, created_by) VALUES (?, ?, ?, ?, 0, 'system')");
  DEFAULT_RULES.forEach(([type, pattern, cat], i) => rule.run([`sys-${i}`, type, pattern, cat]));
  rule.free();
}
