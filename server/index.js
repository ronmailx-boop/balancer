// Entry point: node server/index.js
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Vault } from './vault.js';
import { createApp, HOST } from './app.js';
import { ensurePrivateDir } from './fsutil.js';
import { log } from './log.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const port = Number(process.env.BALANCER_PORT || 8765);
const dataDir = ensurePrivateDir(path.resolve(root, process.env.BALANCER_DATA_DIR || 'data'));
const idleMinutes = Number(process.env.BALANCER_IDLE_MINUTES || 5);

const vault = new Vault(dataDir);
const profilesDir = ensurePrivateDir(path.join(dataDir, 'profiles')); // per-connection browser profiles
const server = createApp({ vault, appDir: path.join(root, 'app'), port, idleMs: idleMinutes * 60 * 1000, profilesDir });

server.on('error', e => {
  log('error', e.code === 'EADDRINUSE' ? `port ${port} is already in use - is Balancer already running?` : e.message);
  process.exit(1);
});
// The pid file lets `balancer stop` / `balancer update` find this process
const pidFile = path.join(dataDir, 'server.pid');
server.listen(port, HOST, () => {
  fs.writeFileSync(pidFile, String(process.pid), { mode: 0o600 });
  log('info', `Balancer is running at http://${HOST}:${port}`);
});
process.on('exit', () => {
  try {
    if (fs.readFileSync(pidFile, 'utf8') === String(process.pid)) fs.rmSync(pidFile);
  } catch { /* already gone */ }
});

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    vault.lock();
    server.close(() => process.exit(0));
  });
}
