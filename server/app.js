// Local HTTP server: serves the PWA and a small JSON API. Bind to 127.0.0.1 only.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { VaultError } from './vault.js';
import { UnlockLimiter } from './ratelimit.js';
import { schemaVersion, openDatabase, migrate } from './db.js';
import { log } from './log.js';
import * as Q from './queries.js';
import { generateDemo, isoDate } from '../shared/demo.js';
import { detectRecurring } from '../shared/recurring.js';
import { detectFixedPayments, setFixedPayment } from './rolling.js';
import { takeAutoSyncSlot, autoSyncEnabled } from './autosync.js';
import { seedCategories } from '../shared/categories.js';
import { SyncManager, credentialAad, removeProfile, connectionsList } from './sync.js';
import { providerById, providers } from '../scraper/providers.js';

export const HOST = '127.0.0.1';
const MAX_BODY = 64 * 1024;
const IDLE_CHOICES = [1, 2, 5, 10, 15, 30, 60];
const MAX_BACKUP_BODY = 80 * 1024 * 1024; // restore uploads the whole encrypted database

const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self' data:",
  "font-src 'self'",
  "connect-src 'self'",
  "manifest-src 'self'",
  "worker-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ');

const SECURITY_HEADERS = {
  'Content-Security-Policy': CSP,
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'no-referrer',
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Resource-Policy': 'same-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
};

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

export function createApp({ vault, appDir, port, idleMs = 5 * 60 * 1000, now = Date.now, profilesDir = null, syncRunner, syncMinIntervalMs }) {
  const sync = new SyncManager({ vault, profilesDir, now, ...(syncRunner ? { runner: syncRunner } : {}), ...(syncMinIntervalMs != null ? { minIntervalMs: syncMinIntervalMs } : {}) });
  const todayIso = () => isoDate(new Date(now()));
  const allowedHosts = new Set([`${HOST}:${port}`, `localhost:${port}`]);
  const allowedOrigins = new Set([...allowedHosts].map(h => `http://${h}`));
  const limiter = new UnlockLimiter({ now });
  let tokenHash = null; // sha256 of the current session token
  let lastActivity = now();
  let unlockBusy = false;

  // The newest change time of the app's files: an open page that loaded an older version reloads
  let versionCache = { at: 0, value: '' };
  const appVersion = () => {
    if (now() - versionCache.at < 5000) return versionCache.value;
    let latest = 0;
    const walk = dir => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) walk(p);
        else latest = Math.max(latest, fs.statSync(p).mtimeMs);
      }
    };
    try { walk(appDir); } catch { /* keep the old value */ }
    versionCache = { at: now(), value: String(Math.floor(latest)) };
    return versionCache.value;
  };

  const startSession = () => {
    const token = crypto.randomBytes(32).toString('base64url');
    tokenHash = sha256(token);
    lastActivity = now();
    return token;
  };
  const endSession = () => {
    tokenHash = null;
    sync.reset();
    dropDemo();
    vault.lock();
  };

  // Demo Mode lives in its own in-memory database and is never saved, so demo and real data cannot mix.
  let demo = null; // { db, day }
  const dropDemo = () => {
    demo?.db.close();
    demo = null;
  };
  const demoEnabled = () => Q.one(vault.db, "SELECT value FROM settings WHERE key = 'demo_mode'")?.value === '1';
  // A sync interrupted by a restart or lock leaves 'syncing' behind
  const clearStaleSyncing = () => {
    if (!sync.status().running) vault.db.run("UPDATE connections SET status = 'error', status_detail = 'INTERRUPTED' WHERE status = 'syncing'");
  };
  // Recurring items depend on today's date (overdue, ended), so they are rebuilt on unlock as well
  const refreshRecurring = () => {
    try {
      detectRecurring(vault.db, todayIso());
      detectFixedPayments(vault.db, todayIso());
      vault.save();
    } catch (e) {
      log('error', `recurring detection failed (${e.message})`);
    }
  };
  // Twice-daily automatic sync (07:00 / 19:00 slots), started when the app is opened.
  // Returns true when a sync was started now.
  const maybeAutoSync = () => {
    if (!vault.unlocked || demoEnabled() || sync.status().running) return false;
    const ids = takeAutoSyncSlot(vault.db, now());
    if (ids === null) return false;
    vault.save();
    if (!ids.length) return false;
    const { queued } = sync.request(ids);
    if (queued.length) log('info', `auto sync started (${queued.length} connections)`);
    return queued.length > 0;
  };
  const ensureSeeded = () => {
    if (Q.one(vault.db, 'SELECT COUNT(*) AS n FROM categories').n === 0) {
      seedCategories(vault.db);
      vault.save();
    }
  };
  // Returns the database the data screens use, and a save function for writes
  const data = async () => {
    if (!demoEnabled()) return { db: vault.db, save: () => vault.save(), demo: false };
    const day = todayIso();
    if (!demo || demo.day !== day) {
      dropDemo();
      const db = await openDatabase();
      migrate(db);
      generateDemo(db, { today: new Date(now()) });
      // The budget cycle is a preference, so the demo follows the real one
      db.run("INSERT OR REPLACE INTO settings (key, value) VALUES ('cycle_start_day', ?)", [String(Q.cycleDay(vault.db))]);
      demo = { db, day };
    }
    return { db: demo.db, save: () => {}, demo: true };
  };
  // Maps validation errors from the query layer to 4xx responses
  const withInput = async fn => {
    try {
      return await fn();
    } catch (e) {
      if (e instanceof Q.InputError) throw new ApiError(e.code === 'not_found' ? 404 : 400, e.code);
      throw e;
    }
  };
  const monthParam = (url, db) => {
    const m = url.searchParams.get('month');
    return Q.isMonth(m) ? m : Q.cycleMonth(todayIso(), Q.cycleDay(db));
  };
  const hasValidToken = req => {
    const m = /^Bearer ([A-Za-z0-9_-]{20,100})$/.exec(req.headers.authorization || '');
    return Boolean(m && tokenHash && crypto.timingSafeEqual(sha256(m[1]), tokenHash));
  };

  // Auto-lock after inactivity
  // The user's auto-lock setting (Settings), or the server default
  const idleLimit = () => {
    const v = vault.unlocked ? Number(Q.one(vault.db, "SELECT value FROM settings WHERE key = 'idle_minutes'")?.value) : NaN;
    return Number.isInteger(v) && v >= 1 && v <= 60 ? v * 60 * 1000 : idleMs;
  };
  const checkIdle = () => {
    // A running sync keeps the vault open (screen off mid-sync); the countdown restarts when it ends
    const st = sync.status();
    if (st.running || st.queued.length) {
      lastActivity = now();
      return;
    }
    if (vault.unlocked && now() - lastActivity > idleLimit()) {
      log('info', 'auto-lock after inactivity');
      endSession();
    }
  };
  const idleTimer = setInterval(checkIdle, 15 * 1000);
  idleTimer.unref();

  const routes = {
    'GET /api/status': async () => ({
      initialized: vault.initialized,
      unlocked: vault.unlocked,
      retryAfterSec: Math.ceil(limiter.retryAfterMs() / 1000),
      version: appVersion(),
    }),

    'POST /api/setup': async ({ body }) => {
      if (vault.initialized) throw new ApiError(409, 'already_initialized');
      await vault.create(body.password);
      ensureSeeded();
      log('info', 'vault created');
      return { token: startSession() };
    },

    'POST /api/unlock': async ({ body }) => {
      const wait = limiter.retryAfterMs();
      if (wait > 0) throw new ApiError(429, 'too_many_attempts', { retryAfterSec: Math.ceil(wait / 1000) });
      if (unlockBusy) throw new ApiError(429, 'busy', { retryAfterSec: 1 });
      unlockBusy = true;
      try {
        vault.lock(); // a new unlock always starts a fresh session
        tokenHash = null;
        await vault.unlock(body.password);
      } catch (e) {
        if (e.code === 'wrong_password') {
          const delay = limiter.fail();
          log('warn', `unlock failed (${limiter.failures} in a row)`);
          throw new ApiError(401, 'wrong_password', { retryAfterSec: Math.ceil(delay / 1000) });
        }
        throw e;
      } finally {
        unlockBusy = false;
      }
      limiter.succeed();
      ensureSeeded();
      clearStaleSyncing();
      refreshRecurring();
      log('info', 'vault unlocked');
      return { token: startSession() };
    },

    'POST /api/lock': async () => {
      endSession();
      return { ok: true };
    },

    'POST /api/password': async ({ body }) => {
      const wait = limiter.retryAfterMs();
      if (wait > 0) throw new ApiError(429, 'too_many_attempts', { retryAfterSec: Math.ceil(wait / 1000) });
      try {
        await vault.changePassword(body.oldPassword, body.newPassword);
      } catch (e) {
        if (e.code === 'wrong_password') {
          const delay = limiter.fail();
          throw new ApiError(401, 'wrong_password', { retryAfterSec: Math.ceil(delay / 1000) });
        }
        throw e;
      }
      limiter.succeed();
      log('info', 'master password changed');
      return { ok: true };
    },

    'GET /api/info': async () => ({
      schemaVersion: schemaVersion(vault.db),
      idleMinutes: Math.round(idleLimit() / 60000),
      demo: demoEnabled(),
      today: todayIso(),
    }),

    'POST /api/settings/demo': async ({ body }) => {
      vault.db.run("INSERT OR REPLACE INTO settings (key, value) VALUES ('demo_mode', ?)", [body.enabled ? '1' : '0']);
      vault.save();
      if (!body.enabled) dropDemo();
      return { demo: Boolean(body.enabled) };
    },

    'GET /api/overview': async ({ url }) => {
      const autoSync = maybeAutoSync();
      const { db, demo: isDemo } = await data();
      return { demo: isDemo, autoSync, today: todayIso(), range: Q.monthRange(db), ...Q.overview(db, { month: monthParam(url, db), today: todayIso() }) };
    },

    'GET /api/month/flow': async ({ url }) => {
      const { db } = await data();
      return Q.monthFlow(db, monthParam(url, db));
    },

    'GET /api/month': async ({ url }) => {
      const { db } = await data();
      return { range: Q.monthRange(db), ...Q.monthDetail(db, monthParam(url, db)) };
    },

    'GET /api/categories': async () => Q.categories((await data()).db),

    'GET /api/categories/manage': async () => Q.manageCategories((await data()).db),

    'POST /api/categories/save': async ({ body }) => withInput(async () => {
      const { db, save } = await data();
      const id = Q.saveCategory(db, {
        id: typeof body.id === 'string' ? body.id : null, name: body.name, icon: body.icon, type: body.type, fixed: Boolean(body.fixed),
      });
      save();
      return { id, ...Q.manageCategories(db) };
    }),

    'POST /api/categories/delete': async ({ body }) => withInput(async () => {
      const { db, save } = await data();
      Q.deleteCategory(db, String(body.id || ''));
      detectRecurring(db, todayIso());
      save();
      return Q.manageCategories(db);
    }),

    'POST /api/rules/add': async ({ body }) => withInput(async () => {
      const { db, save } = await data();
      const changed = Q.addRule(db, { pattern: body.pattern, matchType: body.matchType, categoryId: body.categoryId });
      detectRecurring(db, todayIso());
      save();
      return { changed, ...Q.manageCategories(db) };
    }),

    'POST /api/rules/delete': async ({ body }) => withInput(async () => {
      const { db, save } = await data();
      Q.deleteRule(db, String(body.id || ''));
      detectRecurring(db, todayIso());
      save();
      return Q.manageCategories(db);
    }),

    'GET /api/prefs': async () => {
      const { db } = await data();
      return { ...Q.prefs(db), autoSync: autoSyncEnabled(vault.db), idleMinutes: Math.round(idleLimit() / 60000), idleChoices: IDLE_CHOICES, today: todayIso(), currentMonth: Q.cycleMonth(todayIso(), Q.cycleDay(db)) };
    },

    'POST /api/prefs': async ({ body }) => {
      const { db, save, demo: isDemo } = await data();
      if (body.cycleDay !== undefined) {
        const d = body.cycleDay;
        if (!Number.isInteger(d) || d < 1 || d > 28) throw new ApiError(400, 'bad_request');
        // Saved in the real vault; the demo database gets a copy so the change shows right away
        vault.db.run("INSERT OR REPLACE INTO settings (key, value) VALUES ('cycle_start_day', ?)", [String(d)]);
        vault.save();
        if (isDemo) db.run("INSERT OR REPLACE INTO settings (key, value) VALUES ('cycle_start_day', ?)", [String(d)]);
      }
      if (body.autoSync !== undefined) {
        vault.db.run("INSERT OR REPLACE INTO settings (key, value) VALUES ('auto_sync', ?)", [body.autoSync ? '1' : '0']);
        vault.save();
      }
      if (body.idleMinutes !== undefined) {
        const m = body.idleMinutes;
        if (!IDLE_CHOICES.includes(m)) throw new ApiError(400, 'bad_request');
        vault.db.run("INSERT OR REPLACE INTO settings (key, value) VALUES ('idle_minutes', ?)", [String(m)]);
        vault.save();
      }
      if (body.balanceAccounts !== undefined) {
        const ids = body.balanceAccounts;
        if (!Array.isArray(ids) || ids.length > 50 || ids.some(x => typeof x !== 'string' || x.length > 80)) throw new ApiError(400, 'bad_request');
        const known = new Set(Q.prefs(db).bankAccounts.map(a => a.id));
        db.run("INSERT OR REPLACE INTO settings (key, value) VALUES ('balance_accounts', ?)", [JSON.stringify(ids.filter(id => known.has(id)))]);
        save();
      }
      return { ...Q.prefs(db), currentMonth: Q.cycleMonth(todayIso(), Q.cycleDay(db)) };
    },

    // Fixed monthly payment of a card with rolling credit: a number, 0 = no rolling credit, null = detect
    'POST /api/card-fixed': async ({ body }) => {
      const { db, save } = await data();
      const card = Q.one(db, "SELECT id FROM accounts WHERE id = ? AND type = 'card'", [String(body.accountId || '')]);
      if (!card) throw new ApiError(404, 'not_found');
      const amount = body.amount;
      if (amount !== null && !(typeof amount === 'number' && Number.isFinite(amount) && amount >= 0 && amount <= 1_000_000)) throw new ApiError(400, 'bad_request');
      setFixedPayment(db, card.id, amount);
      if (amount === null) detectFixedPayments(db, todayIso());
      save();
      return { ok: true };
    },

    'GET /api/card-charge': async ({ url }) => {
      const { db } = await data();
      const account = url.searchParams.get('account') || '';
      const date = url.searchParams.get('date') || '';
      if (account.length > 80 || !/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new ApiError(400, 'bad_request');
      const res = Q.cardCharge(db, account, date);
      if (!res) throw new ApiError(404, 'not_found');
      return res;
    },

    'GET /api/accounts': async () => {
      const { db } = await data();
      return Q.accountsOverview(db);
    },

    'GET /api/transactions': async ({ url }) => {
      const { db } = await data();
      const p = Object.fromEntries(url.searchParams);
      return Q.transactions(db, {
        month: p.month, q: Q.cleanText(p.q, 60), account: p.account, category: p.category,
        min: p.min, max: p.max, recurring: p.recurring === '1',
        from: /^\d{4}-\d{2}-\d{2}$/.test(p.from || '') ? p.from : null,
        to: /^\d{4}-\d{2}-\d{2}$/.test(p.to || '') ? p.to : null,
      });
    },

    'GET /api/transaction': async ({ url }) => {
      const { db } = await data();
      const res = Q.transactionById(db, String(url.searchParams.get('id') || '').slice(0, 100));
      if (!res) throw new ApiError(404, 'not_found');
      return res;
    },

    'POST /api/transactions/split': async ({ body }) => {
      const { db, save } = await data();
      if (typeof body.id !== 'string' || !Array.isArray(body.parts) || body.parts.length > 10) throw new ApiError(400, 'bad_request');
      let res;
      try {
        res = Q.setSplits(db, body.id, body.parts.map(p => ({ categoryId: typeof p?.categoryId === 'string' ? p.categoryId : null, amount: p?.amount })));
      } catch {
        throw new ApiError(400, 'bad_split');
      }
      if (!res) throw new ApiError(404, 'not_found');
      save();
      return res;
    },

    'POST /api/transactions/update': async ({ body }) => {
      const { db, save } = await data();
      if (typeof body.id !== 'string') throw new ApiError(400, 'bad_request');
      let result;
      try {
        result = Q.updateTransaction(db, {
          id: body.id,
          categoryId: body.categoryId === undefined ? undefined : (typeof body.categoryId === 'string' ? body.categoryId : null),
          notes: body.notes, tags: body.tags,
          excluded: body.excluded === undefined ? undefined : Boolean(body.excluded),
          applyToMerchant: Boolean(body.applyToMerchant),
        });
      } catch {
        throw new ApiError(400, 'bad_request');
      }
      if (!result) throw new ApiError(404, 'not_found');
      save();
      return result;
    },

    'GET /api/budget': async ({ url }) => {
      const { db } = await data();
      return Q.budget(db, monthParam(url, db));
    },

    'POST /api/budget': async ({ body }) => {
      const { db, save } = await data();
      if (!Q.isMonth(body.month) || !Array.isArray(body.items) || body.items.length > 200) throw new ApiError(400, 'bad_request');
      Q.setBudget(db, body.month, body.items);
      save();
      return Q.budget(db, body.month);
    },

    'POST /api/budget/copy': async ({ body }) => {
      const { db, save } = await data();
      if (!Q.isMonth(body.month)) throw new ApiError(400, 'bad_request');
      Q.copyBudget(db, body.month);
      save();
      return Q.budget(db, body.month);
    },

    'GET /api/trends': async ({ url }) => {
      const months = url.searchParams.get('months') === '12' ? 12 : 6;
      return Q.trends((await data()).db, { months, today: todayIso() });
    },

    'GET /api/recurring': async () => Q.recurringAndInstallments((await data()).db, todayIso()),

    'POST /api/recurring/dismiss': async ({ body }) => {
      const { db, save } = await data();
      if (typeof body.id !== 'string' || body.id.length > 80) throw new ApiError(400, 'bad_request');
      if (!Q.dismissRecurring(db, body.id, Boolean(body.dismissed), todayIso())) throw new ApiError(404, 'not_found');
      save();
      return Q.recurringAndInstallments(db, todayIso());
    },

    // ----- Connections and sync: always the real database, never demo -----
    'GET /api/providers': async () => providers(),

    'GET /api/connections': async () => ({ demo: demoEnabled(), connections: connectionsList(vault.db), sync: sync.status() }),

    'POST /api/connections': async ({ body }) => {
      if (demoEnabled()) throw new ApiError(409, 'demo_on');
      const provider = providerById(body.provider);
      if (!provider) throw new ApiError(400, 'bad_request');
      const credentials = checkCredentials(provider, body.credentials);
      const id = `conn-${crypto.randomBytes(8).toString('hex')}`;
      const name = Q.cleanText(body.displayName, 40) || provider.name;
      vault.db.run('INSERT INTO connections (id, kind, provider, display_name, status, credentials) VALUES (?, ?, ?, ?, \'ok\', ?)',
        [id, provider.kind, provider.id, name, vault.sealField(JSON.stringify(credentials), credentialAad(id))]);
      vault.save();
      log('info', `connection added (${provider.id})`);
      return { id };
    },

    'POST /api/connections/update': async ({ body }) => {
      const conn = Q.one(vault.db, 'SELECT id, provider FROM connections WHERE id = ?', [String(body.id)]);
      if (!conn) throw new ApiError(404, 'not_found');
      const name = Q.cleanText(body.displayName, 40);
      if (name) vault.db.run('UPDATE connections SET display_name = ? WHERE id = ?', [name, conn.id]);
      if (body.credentials) {
        const credentials = checkCredentials(providerById(conn.provider), body.credentials);
        vault.db.run("UPDATE connections SET credentials = ?, status = 'ok', status_detail = NULL WHERE id = ?",
          [vault.sealField(JSON.stringify(credentials), credentialAad(conn.id)), conn.id]);
        sync.forgetAttempt(conn.id);
        log('info', `credentials updated (${conn.provider})`);
      }
      vault.save();
      return { ok: true };
    },

    'POST /api/connections/delete': async ({ body }) => {
      const conn = Q.one(vault.db, 'SELECT id, provider FROM connections WHERE id = ?', [String(body.id)]);
      if (!conn) throw new ApiError(404, 'not_found');
      if (sync.status().running?.connectionId === conn.id) throw new ApiError(409, 'sync_running');
      vault.db.run('DELETE FROM connections WHERE id = ?', [conn.id]); // accounts, transactions, bills cascade
      vault.save();
      if (profilesDir) removeProfile(profilesDir, conn.id);
      log('info', `connection removed (${conn.provider})`);
      return { ok: true };
    },

    'POST /api/sync': async ({ body }) => {
      if (demoEnabled()) throw new ApiError(409, 'demo_on');
      const ids = body.all ? connectionsList(vault.db).map(c => c.id) : [String(body.id)];
      return sync.request(ids);
    },

    'GET /api/sync/status': async () => sync.status(),

    // Restore: on a fresh install (no vault yet) without a session; over an existing vault only
    // with a session and the backup's password. Either way the password must open the backup.
    'POST /api/restore': async ({ body, req }) => {
      if (vault.initialized && (!hasValidToken(req) || !vault.unlocked)) throw new ApiError(401, 'unauthorized');
      const wait = limiter.retryAfterMs();
      if (wait > 0) throw new ApiError(429, 'too_many_attempts', { retryAfterSec: Math.ceil(wait / 1000) });
      if (sync.status().running) throw new ApiError(409, 'sync_running');
      if (unlockBusy) throw new ApiError(429, 'busy', { retryAfterSec: 1 });
      unlockBusy = true;
      try {
        tokenHash = null;
        sync.reset();
        dropDemo();
        await vault.restoreBackup(body.backup, body.password);
      } catch (e) {
        if (e.code === 'wrong_password') {
          const delay = limiter.fail();
          throw new ApiError(401, 'wrong_password', { retryAfterSec: Math.ceil(delay / 1000) });
        }
        throw e;
      } finally {
        unlockBusy = false;
      }
      limiter.succeed();
      ensureSeeded();
      clearStaleSyncing();
      refreshRecurring();
      log('info', 'restored from backup');
      return { token: startSession() };
    },

    'POST /api/wipe': async ({ body }) => {
      const wait = limiter.retryAfterMs();
      if (wait > 0) throw new ApiError(429, 'too_many_attempts', { retryAfterSec: Math.ceil(wait / 1000) });
      if (sync.status().running) throw new ApiError(409, 'sync_running');
      try {
        await vault.verifyPassword(body.password);
      } catch (e) {
        if (e.code === 'wrong_password') {
          const delay = limiter.fail();
          throw new ApiError(401, 'wrong_password', { retryAfterSec: Math.ceil(delay / 1000) });
        }
        throw e;
      }
      limiter.succeed();
      endSession();
      vault.destroy();
      if (profilesDir) for (const d of fs.readdirSync(profilesDir)) fs.rmSync(path.join(profilesDir, d), { recursive: true, force: true });
      log('info', 'all data deleted');
      return { ok: true };
    },
  };
  routes['GET /api/backup'] = async () => null; // streamed below as a file
  routes['GET /api/export.csv'] = async () => null; // streamed above as a file
  const PUBLIC = new Set(['GET /api/status', 'POST /api/setup', 'POST /api/unlock', 'POST /api/restore']);

  const server = http.createServer(async (req, res) => {
    try {
      // DNS-rebinding protection: only our own host names
      if (!allowedHosts.has(req.headers.host)) return send(res, 421, { error: 'bad_host' });

      const url = new URL(req.url, `http://${req.headers.host}`);
      if (!url.pathname.startsWith('/api/')) return serveStatic(appDir, url.pathname, req, res);

      // Same-origin only. No CORS headers are ever sent.
      const origin = req.headers.origin;
      if (origin && !allowedOrigins.has(origin)) return send(res, 403, { error: 'bad_origin' });
      const site = req.headers['sec-fetch-site'];
      if (site && site !== 'same-origin' && site !== 'none') return send(res, 403, { error: 'bad_origin' });

      const key = `${req.method} ${url.pathname}`;
      const handler = routes[key];
      if (!handler) return send(res, 404, { error: 'not_found' });

      checkIdle();
      if (!PUBLIC.has(key)) {
        if (!hasValidToken(req)) return send(res, 401, { error: 'unauthorized' });
        if (!vault.unlocked) return send(res, 401, { error: 'locked' });
        lastActivity = now();
      }

      let body = {};
      if (req.method === 'POST') {
        if (!/^application\/json\b/.test(req.headers['content-type'] || '')) return send(res, 415, { error: 'json_required' });
        body = await readJson(req, key === 'POST /api/restore' ? MAX_BACKUP_BODY : MAX_BODY);
      }
      if (key === 'GET /api/backup') {
        const backup = JSON.stringify(vault.exportBackup());
        log('info', 'backup exported');
        res.writeHead(200, {
          ...SECURITY_HEADERS,
          'Content-Type': 'application/json; charset=utf-8',
          'Content-Disposition': `attachment; filename="balancer-backup-${todayIso()}.json"`,
          'Cache-Control': 'no-store',
        });
        return res.end(backup);
      }
      if (key === 'GET /api/export.csv') {
        const csv = Q.exportCsv((await data()).db);
        res.writeHead(200, {
          ...SECURITY_HEADERS,
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': `attachment; filename="balancer-${todayIso()}.csv"`,
          'Cache-Control': 'no-store',
        });
        return res.end(csv);
      }
      send(res, 200, await handler({ body, req, url }));
    } catch (e) {
      if (e instanceof ApiError) return send(res, e.status, { error: e.code, ...e.extra });
      if (e instanceof VaultError) {
        const status = { weak_password: 400, not_initialized: 409, already_initialized: 409, locked: 401, bad_backup: 400, wrong_password: 401 }[e.code] ?? 500;
        return send(res, status, { error: e.code });
      }
      log('error', `request failed: ${e.name}: ${e.message}`);
      send(res, 500, { error: 'internal' });
    }
  });
  server.on('close', () => clearInterval(idleTimer));
  return server;
}

// Only the provider's own fields, as short strings. Values are never logged.
function checkCredentials(provider, input) {
  if (!provider || !input || typeof input !== 'object') throw new ApiError(400, 'bad_credentials');
  const out = {};
  for (const f of provider.fields) {
    const v = input[f.key];
    if (typeof v !== 'string' || !v.trim() || v.length > 100) throw new ApiError(400, 'bad_credentials');
    out[f.key] = f.type === 'password' ? v : v.trim();
  }
  return out;
}

class ApiError extends Error {
  constructor(status, code, extra = {}) {
    super(code);
    this.status = status;
    this.code = code;
    this.extra = extra;
  }
}

function sha256(s) {
  return crypto.createHash('sha256').update(s).digest();
}

function send(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, {
    ...SECURITY_HEADERS,
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}

function readJson(req, limit = MAX_BODY) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', c => {
      size += c.length;
      if (size > limit) {
        reject(new ApiError(413, 'too_large'));
        req.destroy();
      } else chunks.push(c);
    });
    req.on('end', () => {
      try {
        const v = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
        if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error();
        resolve(v);
      } catch {
        reject(new ApiError(400, 'bad_json'));
      }
    });
    req.on('error', reject);
  });
}

function serveStatic(appDir, pathname, req, res) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, SECURITY_HEADERS);
    return res.end();
  }
  let rel;
  try {
    rel = decodeURIComponent(pathname);
  } catch {
    res.writeHead(400, SECURITY_HEADERS);
    return res.end();
  }
  if (rel.endsWith('/')) rel += 'index.html';
  const file = path.resolve(appDir, '.' + rel);
  if (!file.startsWith(path.resolve(appDir) + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
    res.writeHead(404, { ...SECURITY_HEADERS, 'Content-Type': 'text/plain; charset=utf-8' });
    return res.end('Not found');
  }
  const data = fs.readFileSync(file);
  res.writeHead(200, {
    ...SECURITY_HEADERS,
    'Content-Type': MIME[path.extname(file)] || 'application/octet-stream',
    'Cache-Control': 'no-cache',
    'Content-Length': data.length,
  });
  res.end(req.method === 'HEAD' ? undefined : data);
}
