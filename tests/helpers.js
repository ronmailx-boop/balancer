import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.BALANCER_QUIET = '1';

// Fast KDF for tests only. The real default is checked in crypto.test.js.
export const TEST_KDF = Object.freeze({ name: 'scrypt', N: 2 ** 14, r: 8, p: 1, keyLen: 32 });

export function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'balancer-test-'));
}
