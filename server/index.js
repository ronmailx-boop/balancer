// Entry point: node server/index.js
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
server.listen(port, HOST, () => log('info', `Balancer is running at http://${HOST}:${port}`));

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    vault.lock();
    server.close(() => process.exit(0));
  });
}
