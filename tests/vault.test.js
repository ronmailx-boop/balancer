import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { Vault } from '../server/vault.js';
import { schemaVersion } from '../server/db.js';
import { MIGRATIONS } from '../shared/migrations.js';
import { TEST_KDF, tempDir } from './helpers.js';

const PW = 'correct-horse-1';

async function newVault() {
  const dir = tempDir();
  const v = new Vault(dir, { kdf: TEST_KDF });
  await v.create(PW);
  return { dir, v };
}

test('create -> write -> lock -> unlock keeps the data', async () => {
  const { dir, v } = await newVault();
  assert.ok(v.unlocked);
  assert.equal(schemaVersion(v.db), MIGRATIONS.at(-1).version);
  v.db.run("INSERT INTO categories (id, name, type) VALUES ('food', 'מזון', 'expense')");
  v.save();
  v.lock();
  assert.equal(v.unlocked, false);
  assert.throws(() => v.db, /locked/);

  const again = new Vault(dir, { kdf: TEST_KDF });
  await again.unlock(PW);
  assert.equal(again.db.exec('SELECT name FROM categories')[0].values[0][0], 'מזון');
});

test('nothing readable is stored on disk', async () => {
  const { dir, v } = await newVault();
  v.db.run("INSERT INTO categories (id, name, type) VALUES ('fuel', 'SECRET_MARKER_FUEL', 'expense')");
  v.save();
  const all = fs.readdirSync(dir).map(f => fs.readFileSync(path.join(dir, f)).toString('latin1')).join('\n');
  assert.ok(!all.includes('SECRET_MARKER_FUEL'));
  assert.ok(!all.includes('categories'), 'table names are not visible');
  assert.ok(!all.includes(PW));
  const header = JSON.parse(fs.readFileSync(path.join(dir, 'vault.json'), 'utf8'));
  assert.deepEqual(Object.keys(header.kdf).sort(), ['N', 'keyLen', 'name', 'p', 'r', 'salt']);
});

test('wrong password is rejected', async () => {
  const { dir } = await newVault();
  const v = new Vault(dir, { kdf: TEST_KDF });
  await assert.rejects(v.unlock('wrong-password'), { code: 'wrong_password' });
  await assert.rejects(v.unlock(''), { code: 'wrong_password' });
  assert.equal(v.unlocked, false);
});

test('weak password is rejected at creation', async () => {
  const v = new Vault(tempDir(), { kdf: TEST_KDF });
  await assert.rejects(v.create('short'), { code: 'weak_password' });
  assert.equal(v.initialized, false);
});

test('cannot create twice', async () => {
  const { v } = await newVault();
  await assert.rejects(v.create(PW), { code: 'already_initialized' });
});

test('change password: old stops working, new works, data intact', async () => {
  const { dir, v } = await newVault();
  v.db.run("INSERT INTO settings VALUES ('k', 'v')");
  v.save();
  await assert.rejects(v.changePassword('nope-nope-nope', 'new-password-2'), { code: 'wrong_password' });
  await assert.rejects(v.changePassword(PW, 'short'), { code: 'weak_password' });
  await v.changePassword(PW, 'new-password-2');
  v.lock();
  const again = new Vault(dir, { kdf: TEST_KDF });
  await assert.rejects(again.unlock(PW), { code: 'wrong_password' });
  await again.unlock('new-password-2');
  assert.equal(again.db.exec("SELECT value FROM settings WHERE key='k'")[0].values[0][0], 'v');
});

test('tampered database file is detected', async () => {
  const { dir, v } = await newVault();
  v.lock();
  const file = path.join(dir, 'db.enc');
  const buf = fs.readFileSync(file);
  buf[buf.length - 1] ^= 0xff;
  fs.writeFileSync(file, buf);
  await assert.rejects(new Vault(dir, { kdf: TEST_KDF }).unlock(PW), { code: 'corrupt' });
});

test('missing database file is reported as corrupt', async () => {
  const { dir, v } = await newVault();
  v.lock();
  fs.rmSync(path.join(dir, 'db.enc'));
  await assert.rejects(new Vault(dir, { kdf: TEST_KDF }).unlock(PW), { code: 'corrupt' });
});

test('sealed fields use their own IV and AAD', async () => {
  const { v } = await newVault();
  const a = v.sealField('{"username":"demo"}', 'conn:1');
  const b = v.sealField('{"username":"demo"}', 'conn:1');
  assert.notDeepEqual(a, b);
  assert.equal(v.openField(a, 'conn:1'), '{"username":"demo"}');
  assert.throws(() => v.openField(a, 'conn:2'));
  v.lock();
  assert.throws(() => v.sealField('x', 'conn:1'), /locked/);
});

test('foreign keys stay enforced after save()', async () => {
  const { v } = await newVault();
  v.save();
  assert.throws(() => v.db.run("INSERT INTO accounts (id, connection_id, display_name, masked_number, type) VALUES ('a', 'missing', 'x', '1234', 'card')"));
});
