// Finds a Chromium binary: $CHROME_PATH first, then common locations.
import fs from 'node:fs';

const CANDIDATES = [
  '/usr/bin/chromium',          // Debian (proot-distro)
  '/usr/bin/chromium-browser',
  '/data/data/com.termux/files/usr/bin/chromium-browser', // Termux x11-repo
  '/data/data/com.termux/files/usr/bin/chromium',
];

export function findChromium() {
  const fromEnv = process.env.CHROME_PATH;
  if (fromEnv) return fromEnv;
  const found = CANDIDATES.find(p => fs.existsSync(p));
  if (!found) throw new Error('Chromium not found. Set CHROME_PATH=/path/to/chromium');
  return found;
}

// Flags needed under proot / Termux: no setuid sandbox, no /dev/shm, no GPU.
export const BROWSER_ARGS = [
  '--no-sandbox',
  '--disable-setuid-sandbox',
  '--disable-dev-shm-usage',
  '--disable-gpu',
  '--no-zygote',
  '--no-first-run',
  '--mute-audio',
  // Termux-native Chromium: child processes cannot start under Android's linker
  // ("CANNOT LINK EXECUTABLE /proc/self/exe"), so everything runs in one process.
  ...(process.platform === 'android' || process.env.BALANCER_SINGLE_PROCESS ? ['--single-process'] : []),
];

// Termux preloads libtermux-exec.so. Chromium re-executes itself via /proc/self/exe for its
// child processes, and Android's linker refuses that preload there ("CANNOT LINK EXECUTABLE").
// So Chromium must run without LD_PRELOAD.
export function browserEnv() {
  const env = { ...process.env };
  delete env.LD_PRELOAD;
  return env;
}
