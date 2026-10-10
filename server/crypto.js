// Key derivation and authenticated encryption (AES-256-GCM).
import crypto from 'node:crypto';
import { promisify } from 'node:util';

const scryptAsync = promisify(crypto.scrypt);

// ~0.5-1.5 s on a current phone. Stored in the vault header, so it can be raised later.
export const KDF_DEFAULTS = Object.freeze({ name: 'scrypt', N: 2 ** 17, r: 8, p: 1, keyLen: 32 });
export const KDF_MIN_N = 2 ** 14;

const IV_LEN = 12;
const TAG_LEN = 16;
const MAGIC = Buffer.from('BLNC');
const BLOB_VERSION = 1;

export class DecryptError extends Error {
  constructor() {
    super('decryption failed');
    this.name = 'DecryptError';
  }
}

export function randomBytes(n) {
  return crypto.randomBytes(n);
}

export async function deriveKey(password, salt, params = KDF_DEFAULTS) {
  if (typeof password !== 'string' || password.length === 0) throw new TypeError('password required');
  const { name, N, r, p, keyLen } = params;
  if (name !== 'scrypt' || !Number.isInteger(Math.log2(N)) || N < KDF_MIN_N || keyLen !== 32) {
    throw new Error('unsupported KDF parameters');
  }
  // scrypt needs 128 * N * r bytes; leave headroom
  const maxmem = 128 * N * r * 2 + 16 * 1024 * 1024;
  return scryptAsync(password.normalize('NFC'), salt, keyLen, { N, r, p, maxmem });
}

export function encrypt(key, plaintext, aad) {
  const iv = crypto.randomBytes(IV_LEN);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  if (aad) cipher.setAAD(Buffer.from(aad));
  const ct = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return { iv, tag: cipher.getAuthTag(), ct };
}

export function decrypt(key, { iv, tag, ct }, aad) {
  try {
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    if (aad) decipher.setAAD(Buffer.from(aad));
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ct), decipher.final()]);
  } catch {
    throw new DecryptError();
  }
}

// Binary layout: "BLNC" | version(1) | iv(12) | tag(16) | ciphertext
export function packBlob({ iv, tag, ct }) {
  return Buffer.concat([MAGIC, Buffer.from([BLOB_VERSION]), iv, tag, ct]);
}

export function unpackBlob(buf) {
  const head = MAGIC.length + 1;
  if (buf.length < head + IV_LEN + TAG_LEN || !buf.subarray(0, MAGIC.length).equals(MAGIC) || buf[MAGIC.length] !== BLOB_VERSION) {
    throw new DecryptError();
  }
  return {
    iv: buf.subarray(head, head + IV_LEN),
    tag: buf.subarray(head + IV_LEN, head + IV_LEN + TAG_LEN),
    ct: buf.subarray(head + IV_LEN + TAG_LEN),
  };
}

// JSON-friendly form for the vault header
export const toB64 = ({ iv, tag, ct }) => ({ iv: iv.toString('base64'), tag: tag.toString('base64'), ct: ct.toString('base64') });
export const fromB64 = ({ iv, tag, ct }) => ({ iv: Buffer.from(iv, 'base64'), tag: Buffer.from(tag, 'base64'), ct: Buffer.from(ct, 'base64') });
