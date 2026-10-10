import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import net from 'node:net';
import { fileURLToPath } from 'node:url';
import { Vault } from '../server/vault.js';
import { createApp, HOST } from '../server/app.js';
import { statusForError } from '../server/sync.js';
import { TEST_KDF, tempDir } from './helpers.js';
import { maxFirst } from './fixtures/scrapes.js';

const appDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../app');
const PW = 'correct-horse-1';
const FAKE = { username: 'fake-user-xyz', password: 'FAKE-SECRET-PASSWORD-123' };

const freePort = () => new Promise(resolve => {
  const s = net.createServer().listen(0, HOST, () => { const { port } = s.address(); s.close(() => resolve(port)); });
});

async function start(runner, { minIntervalMs = 60_000 } = {}) {
  const port = await freePort();
  const dir = tempDir();
  const clock = { t: Date.parse('2026-10-10T08:00:00Z') };
  const vault = new Vault(dir, { kdf: TEST_KDF });
  const calls = [];
  const syncRunner = async (job, onProgress) => {
    calls.push(job);
    onProgress('LOGGING_IN');
    return runner(job);
  };
  const server = createApp({ vault, appDir, port, idleMs: 24 * 3600_000, now: () => clock.t, profilesDir: path.join(dir, 'profiles'), syncRunner, syncMinIntervalMs: minIntervalMs });
  await new Promise(r => server.listen(port, HOST, r));
  const req = (method, p, body, token) => new Promise((resolve, reject) => {
    const data = body === undefined ? undefined : JSON.stringify(body);
    const r = http.request({ host: HOST, port, method, path: p, headers: { Host: `${HOST}:${port}`, ...(data ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) } }, res => {
      let raw = '';
      res.on('data', c => { raw += c; });
      res.on('end', () => resolve({ status: res.statusCode, json: raw ? JSON.parse(raw) : null, raw }));
    });
    r.on('error', reject);
    r.end(data);
  });
  const { token } = (await req('POST', '/api/setup', { password: PW })).json;
  const api = (method, p, body) => req(method, p, body, token);
  const waitIdle = async () => {
    for (let i = 0; i < 200; i++) {
      const s = (await api('GET', '/api/sync/status')).json;
      if (!s.running && !s.queued.length) return s;
      await new Promise(r => setTimeout(r, 10));
    }
    throw new Error('sync did not finish');
  };
  return { api, dir, vault, clock, calls, waitIdle, close: () => new Promise(r => server.close(r)) };
}

test('error types map to statuses; credential errors need the user', () => {
  assert.equal(statusForError('INVALID_PASSWORD'), 'needs_attention');
  assert.equal(statusForError('CHANGE_PASSWORD'), 'needs_attention');
  assert.equal(statusForError('ACCOUNT_BLOCKED'), 'needs_attention');
  assert.equal(statusForError('TWO_FACTOR_RETRIEVER_MISSING'), 'otp_required');
  assert.equal(statusForError('TIMEOUT'), 'error');
});

test('providers: Leumi, Cal and Max first, with Hebrew field labels', async t => {
  const s = await start(async () => maxFirst);
  t.after(s.close);
  const list = (await s.api('GET', '/api/providers')).json;
  assert.deepEqual(list.slice(0, 3).map(p => p.id), ['leumi', 'visaCal', 'max']);
  assert.deepEqual(list[0].fields.map(f => f.label), ['שם משתמש', 'סיסמה']);
  assert.ok(!list.some(p => p.id === 'oneZero'));
});

test('credentials are validated, encrypted at rest, and never returned', async t => {
  const s = await start(async () => maxFirst);
  t.after(s.close);
  assert.equal((await s.api('POST', '/api/connections', { provider: 'max', credentials: { username: 'x' } })).status, 400);
  assert.equal((await s.api('POST', '/api/connections', { provider: 'nope', credentials: FAKE })).status, 400);
  const add = await s.api('POST', '/api/connections', { provider: 'max', credentials: { ...FAKE, extra: 'ignored' } });
  assert.equal(add.status, 200);
  const list = await s.api('GET', '/api/connections');
  assert.ok(!list.raw.includes(FAKE.password) && !list.raw.includes(FAKE.username));
  const onDisk = fs.readdirSync(s.dir).filter(f => f.endsWith('.json') || f.endsWith('.enc'))
    .map(f => fs.readFileSync(path.join(s.dir, f)).toString('latin1')).join('');
  assert.ok(!onDisk.includes(FAKE.password));
  assert.ok(!onDisk.includes(FAKE.username));
});

test('successful sync: runner gets decrypted credentials, data is merged, status ok', async t => {
  const s = await start(async () => maxFirst);
  t.after(s.close);
  const { id } = (await s.api('POST', '/api/connections', { provider: 'max', displayName: 'מקס שלי', credentials: FAKE })).json;
  const r = await s.api('POST', '/api/sync', { id });
  assert.deepEqual(r.json.queued, [id]);
  await s.waitIdle();
  assert.deepEqual(s.calls[0].credentials, FAKE);
  assert.equal(s.calls[0].provider, 'max');
  assert.ok(s.calls[0].profileDir.includes(id));
  const conn = (await s.api('GET', '/api/connections')).json.connections[0];
  assert.equal(conn.status, 'ok');
  assert.ok(conn.lastSyncAt);
  const txs = (await s.api('GET', '/api/transactions')).json;
  assert.equal(txs.length, 5);
  const status = (await s.api('GET', '/api/sync/status')).json;
  assert.equal(status.results[id].ok, true);
});

test('wrong password: needs attention, no automatic retry, unblocked only by new credentials', async t => {
  const s = await start(async () => ({ success: false, errorType: 'INVALID_PASSWORD', errorMessage: `bad ${FAKE.username}` }), { minIntervalMs: 0 });
  t.after(s.close);
  const { id } = (await s.api('POST', '/api/connections', { provider: 'leumi', credentials: FAKE })).json;
  await s.api('POST', '/api/sync', { id });
  await s.waitIdle();
  assert.equal(s.calls.length, 1);
  const conn = (await s.api('GET', '/api/connections')).json.connections[0];
  assert.equal(conn.status, 'needs_attention');
  assert.equal(conn.statusDetail, 'INVALID_PASSWORD');

  const again = await s.api('POST', '/api/sync', { id });
  assert.deepEqual(again.json.skipped, [{ id, reason: 'needs_attention' }]);
  await s.waitIdle();
  assert.equal(s.calls.length, 1, 'never retried');

  await s.api('POST', '/api/connections/update', { id, credentials: { ...FAKE, password: 'NEW-FAKE-PASSWORD-9' } });
  assert.equal((await s.api('GET', '/api/connections')).json.connections[0].status, 'ok');
  assert.deepEqual((await s.api('POST', '/api/sync', { id })).json.queued, [id]);
  await s.waitIdle();
  assert.equal(s.calls[1].credentials.password, 'NEW-FAKE-PASSWORD-9');
});

test('syncs are throttled per connection', async t => {
  const s = await start(async () => ({ success: false, errorType: 'TIMEOUT' }), { minIntervalMs: 15 * 60_000 });
  t.after(s.close);
  const { id } = (await s.api('POST', '/api/connections', { provider: 'max', credentials: FAKE })).json;
  await s.api('POST', '/api/sync', { id });
  await s.waitIdle();
  assert.equal((await s.api('GET', '/api/connections')).json.connections[0].status, 'error');
  const soon = await s.api('POST', '/api/sync', { id });
  assert.equal(soon.json.skipped[0].reason, 'too_soon');
  s.clock.t += 16 * 60_000;
  assert.deepEqual((await s.api('POST', '/api/sync', { id })).json.queued, [id]);
  await s.waitIdle();
});

test('demo mode blocks real connections and syncing', async t => {
  const s = await start(async () => maxFirst);
  t.after(s.close);
  const { id } = (await s.api('POST', '/api/connections', { provider: 'max', credentials: FAKE })).json;
  await s.api('POST', '/api/settings/demo', { enabled: true });
  assert.equal((await s.api('POST', '/api/connections', { provider: 'max', credentials: FAKE })).status, 409);
  assert.equal((await s.api('POST', '/api/sync', { id })).status, 409);
});

test('deleting a connection removes its data and browser profile', async t => {
  const s = await start(async job => {
    fs.mkdirSync(job.profileDir, { recursive: true });
    return maxFirst;
  });
  t.after(s.close);
  const { id } = (await s.api('POST', '/api/connections', { provider: 'max', credentials: FAKE })).json;
  await s.api('POST', '/api/sync', { id });
  await s.waitIdle();
  assert.ok(fs.existsSync(s.calls[0].profileDir));
  assert.equal((await s.api('POST', '/api/connections/delete', { id })).status, 200);
  assert.equal((await s.api('GET', '/api/transactions')).json.length, 0);
  assert.equal((await s.api('GET', '/api/connections')).json.connections.length, 0);
  assert.ok(!fs.existsSync(s.calls[0].profileDir));
});

test('a result that arrives after the vault locked is discarded', async t => {
  let release;
  const s = await start(() => new Promise(r => { release = () => r(maxFirst); }));
  t.after(s.close);
  const { id } = (await s.api('POST', '/api/connections', { provider: 'max', credentials: FAKE })).json;
  await s.api('POST', '/api/sync', { id });
  await new Promise(r => setTimeout(r, 20));
  s.vault.lock();
  release();
  await new Promise(r => setTimeout(r, 50));
  await s.vault.unlock(PW);
  const n = s.vault.db.exec('SELECT COUNT(*) FROM transactions')[0].values[0][0];
  assert.equal(n, 0);
});
