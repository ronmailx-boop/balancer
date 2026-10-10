// The encrypted store.
//   vault.json  - KDF params, salt, and the data key wrapped by the password key (no secrets in clear)
//   db.enc      - the whole SQLite database, AES-256-GCM encrypted with the data key
// The master password is never stored. The data key lives in memory only while unlocked.
import fs from 'node:fs';
import path from 'node:path';
import {
  KDF_DEFAULTS, deriveKey, encrypt, decrypt, packBlob, unpackBlob, toB64, fromB64, randomBytes, DecryptError,
} from './crypto.js';
import { writeFileAtomic, ensurePrivateDir } from './fsutil.js';
import { openDatabase, migrate } from './db.js';

const HEADER_VERSION = 1;
const AAD_KEY = 'balancer:data-key:v1';
const AAD_DB = 'balancer:db:v1';
export const MIN_PASSWORD_LENGTH = 8;

export class VaultError extends Error {
  constructor(code) {
    super(code);
    this.code = code;
  }
}

export class Vault {
  #dir;
  #kdf;
  #dataKey = null;
  #db = null;

  constructor(dir, { kdf = KDF_DEFAULTS } = {}) {
    this.#dir = dir;
    this.#kdf = kdf;
  }

  get headerPath() { return path.join(this.#dir, 'vault.json'); }
  get dbPath() { return path.join(this.#dir, 'db.enc'); }
  get initialized() { return fs.existsSync(this.headerPath); }
  get unlocked() { return this.#db !== null; }

  get db() {
    if (!this.#db) throw new VaultError('locked');
    return this.#db;
  }

  async create(password) {
    if (this.initialized) throw new VaultError('already_initialized');
    checkPassword(password);
    ensurePrivateDir(this.#dir);
    const salt = randomBytes(16);
    const kek = await deriveKey(password, salt, this.#kdf);
    const dataKey = randomBytes(32);
    const header = {
      version: HEADER_VERSION,
      kdf: { ...this.#kdf, salt: salt.toString('base64') },
      wrappedKey: toB64(encrypt(kek, dataKey, AAD_KEY)),
      createdAt: new Date().toISOString(),
    };
    kek.fill(0);
    const db = await openDatabase();
    migrate(db);
    this.#dataKey = dataKey;
    this.#db = db;
    this.save();
    writeFileAtomic(this.headerPath, JSON.stringify(header, null, 2));
  }

  async unlock(password) {
    if (!this.initialized) throw new VaultError('not_initialized');
    if (this.unlocked) return;
    const header = this.#readHeader();
    const dataKey = await this.#unwrap(header, password);
    let bytes;
    try {
      bytes = decrypt(dataKey, unpackBlob(fs.readFileSync(this.dbPath)), AAD_DB);
    } catch (e) {
      dataKey.fill(0);
      throw new VaultError(e instanceof DecryptError || e.code === 'ENOENT' ? 'corrupt' : 'io_error');
    }
    // sql.js keeps a reference to this buffer as its in-memory file, so it must not be zeroed
    const db = await openDatabase(bytes);
    this.#dataKey = dataKey;
    this.#db = db;
    if (migrate(db) > 0) this.save();
  }

  lock() {
    this.#db?.close();
    this.#db = null;
    this.#dataKey?.fill(0);
    this.#dataKey = null;
  }

  async changePassword(oldPassword, newPassword) {
    checkPassword(newPassword);
    const header = this.#readHeader();
    const dataKey = await this.#unwrap(header, oldPassword);
    const salt = randomBytes(16);
    const kek = await deriveKey(newPassword, salt, this.#kdf);
    const next = {
      ...header,
      kdf: { ...this.#kdf, salt: salt.toString('base64') },
      wrappedKey: toB64(encrypt(kek, dataKey, AAD_KEY)),
      passwordChangedAt: new Date().toISOString(),
    };
    kek.fill(0);
    dataKey.fill(0);
    writeFileAtomic(this.headerPath, JSON.stringify(next, null, 2));
  }

  // Persist the in-memory database. Call after every write.
  save() {
    const bytes = Buffer.from(this.db.export());
    // sql.js export() reopens the database, which resets connection pragmas
    this.#db.run('PRAGMA foreign_keys = ON');
    writeFileAtomic(this.dbPath, packBlob(encrypt(this.#dataKey, bytes, AAD_DB)));
    bytes.fill(0);
  }

  // Encrypt a single field (e.g. bank credentials) with its own IV, under the data key.
  sealField(plaintext, aad) {
    if (!this.#dataKey) throw new VaultError('locked');
    return packBlob(encrypt(this.#dataKey, Buffer.from(plaintext, 'utf8'), aad));
  }

  openField(blob, aad) {
    if (!this.#dataKey) throw new VaultError('locked');
    return decrypt(this.#dataKey, unpackBlob(Buffer.from(blob)), aad).toString('utf8');
  }

  #readHeader() {
    let header;
    try {
      header = JSON.parse(fs.readFileSync(this.headerPath, 'utf8'));
    } catch {
      throw new VaultError('corrupt');
    }
    if (header.version !== HEADER_VERSION || !header.kdf?.salt || !header.wrappedKey) throw new VaultError('corrupt');
    return header;
  }

  async #unwrap(header, password) {
    if (typeof password !== 'string' || !password) throw new VaultError('wrong_password');
    const kek = await deriveKey(password, Buffer.from(header.kdf.salt, 'base64'), pickKdf(header.kdf));
    try {
      return decrypt(kek, fromB64(header.wrappedKey), AAD_KEY);
    } catch {
      throw new VaultError('wrong_password');
    } finally {
      kek.fill(0);
    }
  }
}

function pickKdf({ name, N, r, p, keyLen }) {
  return { name, N, r, p, keyLen };
}

function checkPassword(password) {
  if (typeof password !== 'string' || [...password].length < MIN_PASSWORD_LENGTH) throw new VaultError('weak_password');
}
