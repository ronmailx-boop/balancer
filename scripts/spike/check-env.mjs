// Phase 0: checks Node version, crypto (scrypt + AES-256-GCM), and the
// two storage candidates (node:sqlite, sql.js). Uses fake data only.
import crypto from 'node:crypto';
import os from 'node:os';

const results = [];
const ok = (name, detail) => results.push(['OK  ', name, detail]);
const fail = (name, detail) => results.push(['FAIL', name, detail]);

// Node version: israeli-bank-scrapers 6.12.x declares node >= 22.22.2
const [maj, min, pat] = process.versions.node.split('.').map(Number);
const nodeOk = maj > 22 || (maj === 22 && (min > 22 || (min === 22 && pat >= 2)));
(nodeOk ? ok : fail)('node version', `${process.version} (need >= 22.22.2) on ${os.arch()}`);

// scrypt cost: pick N so unlock takes ~0.5-1.5s on the phone
const salt = crypto.randomBytes(16);
for (const logN of [15, 16, 17]) {
  const t0 = performance.now();
  try {
    crypto.scryptSync('fake-master-password', salt, 32, { N: 2 ** logN, r: 8, p: 1, maxmem: 256 * 1024 * 1024 });
    ok(`scrypt N=2^${logN}`, `${(performance.now() - t0).toFixed(0)} ms`);
  } catch (e) {
    fail(`scrypt N=2^${logN}`, e.message);
  }
}
ok('argon2 (node:crypto)', typeof crypto.argon2Sync === 'function' ? 'available' : 'not available - scrypt will be used');

// AES-256-GCM round trip
const key = crypto.randomBytes(32);
const iv = crypto.randomBytes(12);
const c = crypto.createCipheriv('aes-256-gcm', key, iv);
const ct = Buffer.concat([c.update('{"demo":true}'), c.final()]);
const d = crypto.createDecipheriv('aes-256-gcm', key, iv);
d.setAuthTag(c.getAuthTag());
const pt = Buffer.concat([d.update(ct), d.final()]).toString();
(pt === '{"demo":true}' ? ok : fail)('aes-256-gcm', 'round trip');

// node:sqlite (built in, experimental in Node 22)
try {
  const { DatabaseSync } = await import('node:sqlite');
  const db = new DatabaseSync(':memory:');
  db.exec('CREATE TABLE t (x TEXT)');
  db.prepare('INSERT INTO t VALUES (?)').run('שלום');
  ok('node:sqlite', `read back "${db.prepare('SELECT x FROM t').get().x}"`);
} catch (e) {
  fail('node:sqlite', e.message);
}

// sql.js (pure WASM): in-memory DB, whole file encrypted on save
try {
  const { default: initSqlJs } = await import('sql.js');
  const SQL = await initSqlJs();
  const db = new SQL.Database();
  db.run('CREATE TABLE tx (id TEXT PRIMARY KEY, description TEXT, amount REAL)');
  const ins = db.prepare('INSERT INTO tx VALUES (?,?,?)');
  let t0 = performance.now();
  db.run('BEGIN');
  for (let i = 0; i < 20000; i++) ins.run([crypto.randomUUID(), `שופרסל דמו ${i}`, -i / 10]);
  db.run('COMMIT');
  const insertMs = performance.now() - t0;
  t0 = performance.now();
  const buf = db.export();
  const iv2 = crypto.randomBytes(12);
  const c2 = crypto.createCipheriv('aes-256-gcm', key, iv2);
  const enc = Buffer.concat([c2.update(buf), c2.final()]);
  const d2 = crypto.createDecipheriv('aes-256-gcm', key, iv2);
  d2.setAuthTag(c2.getAuthTag());
  const db2 = new SQL.Database(Buffer.concat([d2.update(enc), d2.final()]));
  const n = db2.exec('SELECT count(*) FROM tx')[0].values[0][0];
  ok('sql.js', `20k inserts ${insertMs.toFixed(0)} ms; ${(buf.length / 1e6).toFixed(1)} MB encrypt+reload ${(performance.now() - t0).toFixed(0)} ms; rows=${n}`);
} catch (e) {
  fail('sql.js', e.message);
}

for (const [s, name, detail] of results) console.log(`${s} ${name.padEnd(22)} ${detail}`);
process.exitCode = results.some(r => r[0] === 'FAIL') ? 1 : 0;
