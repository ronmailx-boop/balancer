// Automatic sync twice a day, when the app is opened: once from 07:00 and once from 19:00
// (Israel time). Opening the app after 19:00 or before 07:00 the next morning belongs to the
// evening slot. Each slot syncs at most once, even if that sync fails (account safety).
const fmt = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Jerusalem', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23',
});

function israelParts(ms) {
  const p = Object.fromEntries(fmt.formatToParts(new Date(ms)).map(x => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, hour: Number(p.hour) };
}

export const MORNING_HOUR = 7;
export const EVENING_HOUR = 19;

export function slotKey(ms) {
  const { date, hour } = israelParts(ms);
  if (hour >= EVENING_HOUR) return `${date} evening`;
  if (hour >= MORNING_HOUR) return `${date} morning`;
  return `${israelParts(ms - 12 * 3600 * 1000).date} evening`; // after midnight: still last night's slot
}

const setting = (db, key) => {
  const stmt = db.prepare('SELECT value FROM settings WHERE key = ?');
  try {
    stmt.bind([key]);
    return stmt.step() ? stmt.getAsObject().value : null;
  } finally {
    stmt.free();
  }
};

export const autoSyncEnabled = db => setting(db, 'auto_sync') !== '0';

// Returns null when the slot was already used (or auto sync is off). Otherwise marks the slot as
// used and returns the connection ids to sync: those not synced in this slot yet (maybe none).
export function takeAutoSyncSlot(db, nowMs) {
  if (!autoSyncEnabled(db)) return null;
  const key = slotKey(nowMs);
  if (setting(db, 'auto_sync_slot') === key) return null;
  const conns = [];
  const stmt = db.prepare("SELECT id, last_sync_at FROM connections WHERE status != 'needs_attention'");
  while (stmt.step()) conns.push(stmt.getAsObject());
  stmt.free();
  db.run("INSERT OR REPLACE INTO settings (key, value) VALUES ('auto_sync_slot', ?)", [key]);
  return conns.filter(c => !c.last_sync_at || slotKey(Date.parse(c.last_sync_at)) !== key).map(c => c.id);
}
