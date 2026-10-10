// Encrypted backup file: download, and restore (fresh install or from Settings).
import { api, session } from './api.js';
import { h } from './ui.js';

const MAX_FILE = 80 * 1024 * 1024;

export async function downloadBackup() {
  const res = await fetch('/api/backup', { headers: { Authorization: `Bearer ${session.token}` }, cache: 'no-store' });
  if (!res.ok) throw Object.assign(new Error(), { code: res.status === 401 ? 'locked' : 'internal' });
  const name = /filename="([^"]+)"/.exec(res.headers.get('Content-Disposition') || '')?.[1] || 'balancer-backup.json';
  const url = URL.createObjectURL(await res.blob());
  const a = h('a', { href: url, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return name;
}

// Returns the new session token
export async function restoreBackup(file, password) {
  if (file.size > MAX_FILE) throw { code: 'bad_backup' };
  let backup;
  try {
    backup = JSON.parse(await file.text());
  } catch {
    throw { code: 'bad_backup' };
  }
  const { token } = await api('restore', { method: 'POST', body: { backup, password } });
  return token;
}
