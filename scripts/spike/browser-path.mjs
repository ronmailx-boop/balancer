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

// Termux's chromium-browser is a wrapper script that needs Termux's LD_PRELOAD (termux-exec);
// removing it makes the launch fail with exit code 126. Keep the environment as is.
// The "CANNOT LINK EXECUTABLE /proc/self/exe" lines it causes in child processes are
// avoided by --single-process (see BROWSER_ARGS).
export function browserEnv() {
  return { ...process.env };
}
