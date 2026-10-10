import test from 'node:test';
import assert from 'node:assert/strict';
import {
  KDF_DEFAULTS, KDF_MIN_N, deriveKey, encrypt, decrypt, packBlob, unpackBlob, randomBytes, DecryptError,
} from '../server/crypto.js';
import { TEST_KDF } from './helpers.js';

test('default KDF parameters are strong', () => {
  assert.equal(KDF_DEFAULTS.name, 'scrypt');
  assert.ok(KDF_DEFAULTS.N >= 2 ** 17, 'N >= 2^17');
  assert.ok(KDF_DEFAULTS.r >= 8);
  assert.equal(KDF_DEFAULTS.keyLen, 32);
});

test('KDF rejects weak or malformed parameters', async () => {
  const salt = randomBytes(16);
  await assert.rejects(deriveKey('password1', salt, { ...TEST_KDF, N: KDF_MIN_N / 2 }));
  await assert.rejects(deriveKey('password1', salt, { ...TEST_KDF, N: 3000 }));
  await assert.rejects(deriveKey('password1', salt, { ...TEST_KDF, name: 'pbkdf2' }));
  await assert.rejects(deriveKey('', salt, TEST_KDF));
});

test('KDF is deterministic per salt and differs across salts', async () => {
  const s1 = randomBytes(16);
  const s2 = randomBytes(16);
  const a = await deriveKey('סיסמה-בעברית', s1, TEST_KDF);
  const b = await deriveKey('סיסמה-בעברית', s1, TEST_KDF);
  const c = await deriveKey('סיסמה-בעברית', s2, TEST_KDF);
  assert.equal(a.length, 32);
  assert.deepEqual(a, b);
  assert.notDeepEqual(a, c);
});

test('KDF normalizes Unicode so the same typed password always works', async () => {
  const salt = randomBytes(16);
  const composed = 'café-password';
  const decomposed = 'café-password';
  assert.deepEqual(await deriveKey(composed, salt, TEST_KDF), await deriveKey(decomposed, salt, TEST_KDF));
});

test('AES-256-GCM round trip with a fresh IV each time', () => {
  const key = randomBytes(32);
  const a = encrypt(key, Buffer.from('demo data'), 'aad');
  const b = encrypt(key, Buffer.from('demo data'), 'aad');
  assert.notDeepEqual(a.iv, b.iv);
  assert.notDeepEqual(a.ct, b.ct);
  assert.equal(decrypt(key, a, 'aad').toString(), 'demo data');
});

test('decryption fails on wrong key, wrong AAD, or tampering', () => {
  const key = randomBytes(32);
  const box = encrypt(key, Buffer.from('demo data'), 'aad');
  assert.throws(() => decrypt(randomBytes(32), box, 'aad'), DecryptError);
  assert.throws(() => decrypt(key, box, 'other'), DecryptError);
  const ct = Buffer.from(box.ct);
  ct[0] ^= 1;
  assert.throws(() => decrypt(key, { ...box, ct }, 'aad'), DecryptError);
});

test('blob pack/unpack round trip and rejects garbage', () => {
  const key = randomBytes(32);
  const blob = packBlob(encrypt(key, Buffer.from('x'), 'a'));
  assert.equal(decrypt(key, unpackBlob(blob), 'a').toString(), 'x');
  assert.throws(() => unpackBlob(Buffer.from('not a blob at all, definitely not')), DecryptError);
  assert.throws(() => unpackBlob(Buffer.alloc(3)), DecryptError);
});
