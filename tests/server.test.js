import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Vault } from '../server/vault.js';
import { createApp, HOST } from '../server/app.js';
import { TEST_KDF, tempDir } from './helpers.js';

const appDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../app');
const PW = 'correct-horse-1';

function freePort() {
  return new Promise(resolve => {
    const s = net.createServer().listen(0, HOST, () => {
      const { port } = s.address();
      s.close(() => resolve(port));
    });
  });
}

async function start({ idleMs } = {}) {
  const port = await freePort();
  const clock = { t: 1_000_000 };
  const vault = new Vault(tempDir(), { kdf: TEST_KDF });
  const server = createApp({ vault, appDir, port, idleMs, now: () => clock.t });
  await new Promise(r => server.listen(port, HOST, r));
  const req = (method, p, { body, token, headers = {} } = {}) => new Promise((resolve, reject) => {
    const data = body === undefined ? undefined : JSON.stringify(body);
    const r = http.request({
      host: HOST, port, method, path: p,
      headers: {
        Host: `${HOST}:${port}`,
        ...(data ? { 'Content-Type': 'application/json' } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...headers,
      },
    }, res => {
      let raw = '';
      res.on('data', c => { raw += c; });
      res.on('end', () => {
        let json = null;
        try { json = JSON.parse(raw); } catch { /* static file */ }
        resolve({ status: res.statusCode, headers: res.headers, json, raw });
      });
    });
    r.on('error', reject);
    r.end(data);
  });
  return { port, clock, vault, server, req, close: () => new Promise(r => server.close(r)) };
}

test('listens on 127.0.0.1 only', async t => {
  const s = await start();
  t.after(s.close);
  assert.equal(s.server.address().address, '127.0.0.1');
});

test('serves the app with strict security headers', async t => {
  const s = await start();
  t.after(s.close);
  const res = await s.req('GET', '/');
  assert.equal(res.status, 200);
  assert.match(res.raw, /dir="rtl"/);
  const csp = res.headers['content-security-policy'];
  assert.match(csp, /default-src 'self'/);
  assert.match(csp, /script-src 'self'(;|$)/);
  assert.doesNotMatch(csp, /unsafe-inline|unsafe-eval|https?:/);
  assert.equal(res.headers['x-frame-options'], 'DENY');
  assert.equal(res.headers['referrer-policy'], 'no-referrer');
  assert.equal(res.headers['access-control-allow-origin'], undefined);
});

test('blocks path traversal', async t => {
  const s = await start();
  t.after(s.close);
  for (const p of ['/../package.json', '/%2e%2e/package.json', '/..%2fserver/vault.js']) {
    const res = await s.req('GET', p);
    assert.notEqual(res.status, 200, p);
  }
});

test('rejects foreign Host headers (DNS rebinding)', async t => {
  const s = await start();
  t.after(s.close);
  const res = await s.req('GET', '/api/status', { headers: { Host: `evil.example:${s.port}` } });
  assert.equal(res.status, 421);
});

test('rejects cross-origin API calls', async t => {
  const s = await start();
  t.after(s.close);
  let res = await s.req('GET', '/api/status', { headers: { Origin: 'https://evil.example' } });
  assert.equal(res.status, 403);
  res = await s.req('GET', '/api/status', { headers: { 'Sec-Fetch-Site': 'cross-site' } });
  assert.equal(res.status, 403);
  res = await s.req('GET', '/api/status', { headers: { Origin: `http://${HOST}:${s.port}`, 'Sec-Fetch-Site': 'same-origin' } });
  assert.equal(res.status, 200);
});

test('POST requires JSON (blocks simple form CSRF)', async t => {
  const s = await start();
  t.after(s.close);
  const res = await s.req('POST', '/api/setup', { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });
  assert.equal(res.status, 415);
});

test('setup -> token -> protected route; no token or wrong token is refused', async t => {
  const s = await start();
  t.after(s.close);
  assert.deepEqual((await s.req('GET', '/api/status')).json, { initialized: false, unlocked: false, retryAfterSec: 0 });
  assert.equal((await s.req('POST', '/api/setup', { body: { password: 'short' } })).json.error, 'weak_password');

  const setup = await s.req('POST', '/api/setup', { body: { password: PW } });
  assert.equal(setup.status, 200);
  const { token } = setup.json;
  assert.ok(token.length >= 40);
  assert.equal((await s.req('POST', '/api/setup', { body: { password: PW } })).status, 409);

  assert.equal((await s.req('GET', '/api/info')).status, 401);
  assert.equal((await s.req('GET', '/api/info', { token: 'x'.repeat(43) })).status, 401);
  const info = await s.req('GET', '/api/info', { token });
  assert.equal(info.status, 200);
  assert.equal(info.headers['cache-control'], 'no-store');
  assert.ok(info.json.schemaVersion >= 1);
});

test('lock ends the session; unlock issues a new token', async t => {
  const s = await start();
  t.after(s.close);
  const { token } = (await s.req('POST', '/api/setup', { body: { password: PW } })).json;
  assert.equal((await s.req('POST', '/api/lock', { token, body: {} })).status, 200);
  assert.equal(s.vault.unlocked, false);
  assert.equal((await s.req('GET', '/api/info', { token })).status, 401);
  const again = await s.req('POST', '/api/unlock', { body: { password: PW } });
  assert.equal(again.status, 200);
  assert.notEqual(again.json.token, token);
  assert.equal((await s.req('GET', '/api/info', { token: again.json.token })).status, 200);
});

test('unlock failures back off exponentially and reset on success', async t => {
  const s = await start();
  t.after(s.close);
  await s.req('POST', '/api/setup', { body: { password: PW } });
  await s.req('POST', '/api/lock', { body: {} }).catch(() => {});
  s.vault.lock();

  let res = await s.req('POST', '/api/unlock', { body: { password: 'wrong-1' } });
  assert.equal(res.status, 401);
  assert.equal(res.json.retryAfterSec, 1);

  // Correct password is refused while the delay is running
  res = await s.req('POST', '/api/unlock', { body: { password: PW } });
  assert.equal(res.status, 429);

  s.clock.t += 1000;
  res = await s.req('POST', '/api/unlock', { body: { password: 'wrong-2' } });
  assert.equal(res.json.retryAfterSec, 2);
  s.clock.t += 2000;
  res = await s.req('POST', '/api/unlock', { body: { password: 'wrong-3' } });
  assert.equal(res.json.retryAfterSec, 4);
  assert.equal((await s.req('GET', '/api/status')).json.retryAfterSec, 4);

  s.clock.t += 4000;
  res = await s.req('POST', '/api/unlock', { body: { password: PW } });
  assert.equal(res.status, 200);

  s.vault.lock();
  res = await s.req('POST', '/api/unlock', { body: { password: 'wrong-again' } });
  assert.equal(res.json.retryAfterSec, 1, 'counter reset after success');
});

test('change password through the API', async t => {
  const s = await start();
  t.after(s.close);
  const { token } = (await s.req('POST', '/api/setup', { body: { password: PW } })).json;
  let res = await s.req('POST', '/api/password', { token, body: { oldPassword: 'nope-nope', newPassword: 'another-pass-2' } });
  assert.equal(res.status, 401);
  s.clock.t += 1000;
  res = await s.req('POST', '/api/password', { token, body: { oldPassword: PW, newPassword: 'another-pass-2' } });
  assert.equal(res.status, 200);
  s.vault.lock();
  assert.equal((await s.req('POST', '/api/unlock', { body: { password: 'another-pass-2' } })).status, 200);
});

test('auto-locks after inactivity', async t => {
  const s = await start({ idleMs: 60_000 });
  t.after(s.close);
  const { token } = (await s.req('POST', '/api/setup', { body: { password: PW } })).json;
  s.clock.t += 30_000;
  assert.equal((await s.req('GET', '/api/info', { token })).status, 200);
  s.clock.t += 61_000;
  assert.equal((await s.req('GET', '/api/info', { token })).status, 401);
  assert.equal(s.vault.unlocked, false);
});

test('rejects oversized and malformed bodies', async t => {
  const s = await start();
  t.after(s.close);
  const big = await s.req('POST', '/api/unlock', { body: { password: 'x'.repeat(100_000) } }).catch(e => ({ status: 'reset', e }));
  assert.ok(big.status === 413 || big.status === 'reset');
  const bad = await new Promise(resolve => {
    const r = http.request({ host: HOST, port: s.port, method: 'POST', path: '/api/unlock', headers: { Host: `${HOST}:${s.port}`, 'Content-Type': 'application/json' } },
      res => { res.resume(); resolve(res.statusCode); });
    r.end('{not json');
  });
  assert.equal(bad, 400);
});

test('demo mode never touches the real database', async t => {
  const s = await start();
  t.after(s.close);
  const { token } = (await s.req('POST', '/api/setup', { body: { password: PW } })).json;
  let o = await s.req('GET', '/api/overview', { token });
  assert.equal(o.json.demo, false);
  assert.equal(o.json.hasData, false);
  assert.ok((await s.req('GET', '/api/categories', { token })).json.length > 10, 'real vault gets default categories');

  await s.req('POST', '/api/settings/demo', { token, body: { enabled: true } });
  o = await s.req('GET', '/api/overview', { token });
  assert.equal(o.json.demo, true);
  assert.equal(o.json.balances.accounts.length, 3);
  const tx = (await s.req('GET', '/api/transactions', { token })).json[0];
  const upd = await s.req('POST', '/api/transactions/update', { token, body: { id: tx.id, notes: 'demo note' } });
  assert.equal(upd.json.transaction.notes, 'demo note');

  await s.req('POST', '/api/settings/demo', { token, body: { enabled: false } });
  assert.equal(Q(s.vault.db, 'SELECT COUNT(*) AS n FROM transactions').n, 0);
  assert.equal(Q(s.vault.db, 'SELECT COUNT(*) AS n FROM accounts').n, 0);
  assert.equal((await s.req('GET', '/api/transactions', { token })).json.length, 0);
});

test('data routes require a session and validate input', async t => {
  const s = await start();
  t.after(s.close);
  const { token } = (await s.req('POST', '/api/setup', { body: { password: PW } })).json;
  for (const p of ['/api/overview', '/api/transactions', '/api/budget', '/api/trends', '/api/export.csv']) {
    assert.equal((await s.req('GET', p)).status, 401, p);
  }
  assert.equal((await s.req('POST', '/api/budget', { token, body: { month: 'bad', items: [] } })).status, 400);
  assert.equal((await s.req('POST', '/api/transactions/update', { token, body: { id: 'missing' } })).status, 404);
  const csv = await s.req('GET', '/api/export.csv', { token });
  assert.equal(csv.status, 200);
  assert.match(csv.headers['content-type'], /text\/csv/);
});

function Q(db, sql) {
  const stmt = db.prepare(sql);
  stmt.step();
  const row = stmt.getAsObject();
  stmt.free();
  return row;
}
