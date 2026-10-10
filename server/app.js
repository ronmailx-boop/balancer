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
import { seedCategories } from '../shared/categories.js';

export const HOST = '127.0.0.1';
const MAX_BODY = 64 * 1024;

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

export function createApp({ vault, appDir, port, idleMs = 5 * 60 * 1000, now = Date.now }) {
  const todayIso = () => isoDate(new Date(now()));
  const allowedHosts = new Set([`${HOST}:${port}`, `localhost:${port}`]);
  const allowedOrigins = new Set([...allowedHosts].map(h => `http://${h}`));
  const limiter = new UnlockLimiter({ now });
  let tokenHash = null; // sha256 of the current session token
  let lastActivity = now();
  let unlockBusy = false;

  const startSession = () => {
    const token = crypto.randomBytes(32).toString('base64url');
    tokenHash = sha256(token);
    lastActivity = now();
    return token;
  };
  const endSession = () => {
    tokenHash = null;
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
      demo = { db, day };
    }
    return { db: demo.db, save: () => {}, demo: true };
  };
  const monthParam = url => {
    const m = url.searchParams.get('month');
    return Q.isMonth(m) ? m : Q.currentMonth(new Date(now()));
  };
  const hasValidToken = req => {
    const m = /^Bearer ([A-Za-z0-9_-]{20,100})$/.exec(req.headers.authorization || '');
    return Boolean(m && tokenHash && crypto.timingSafeEqual(sha256(m[1]), tokenHash));
  };

  // Auto-lock after inactivity
  const checkIdle = () => {
    if (vault.unlocked && now() - lastActivity > idleMs) {
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
      idleMinutes: Math.round(idleMs / 60000),
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
      const { db, demo: isDemo } = await data();
      return { demo: isDemo, today: todayIso(), range: Q.monthRange(db), ...Q.overview(db, { month: monthParam(url), today: todayIso() }) };
    },

    'GET /api/month': async ({ url }) => {
      const { db } = await data();
      return { range: Q.monthRange(db), ...Q.monthDetail(db, monthParam(url)) };
    },

    'GET /api/categories': async () => Q.categories((await data()).db),

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

    'GET /api/budget': async ({ url }) => Q.budget((await data()).db, monthParam(url)),

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
  };
  routes['GET /api/export.csv'] = async () => null; // streamed above as a file
  const PUBLIC = new Set(['GET /api/status', 'POST /api/setup', 'POST /api/unlock']);

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
        body = await readJson(req);
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
        const status = { weak_password: 400, not_initialized: 409, already_initialized: 409, locked: 401 }[e.code] ?? 500;
        return send(res, status, { error: e.code });
      }
      log('error', `request failed: ${e.name}: ${e.message}`);
      send(res, 500, { error: 'internal' });
    }
  });
  server.on('close', () => clearInterval(idleTimer));
  return server;
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

function readJson(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', c => {
      size += c.length;
      if (size > MAX_BODY) {
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
