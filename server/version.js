// Release number shown in Settings: 1.<number of commits>, so every update gets a new, larger number
// that Claude can name in advance. Falls back to package.json when git is not available.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export function releaseVersion() {
  try {
    const count = execFileSync('git', ['rev-list', '--count', 'HEAD'], { cwd: root, stdio: ['ignore', 'pipe', 'ignore'], timeout: 3000 })
      .toString().trim();
    if (/^\d+$/.test(count)) return `1.${count}`;
  } catch { /* no git */ }
  try {
    return JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version;
  } catch {
    return '?';
  }
}
