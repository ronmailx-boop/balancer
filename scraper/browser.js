// Chromium for the scraper. On the phone this is Termux's own `chromium-browser`.
import fs from 'node:fs';

const CANDIDATES = [
  '/data/data/com.termux/files/usr/bin/chromium-browser', // Termux (x11-repo)
  '/data/data/com.termux/files/usr/bin/chromium',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
];

export function findChromium() {
  const fromEnv = process.env.CHROME_PATH;
  if (fromEnv) return fromEnv;
  const found = CANDIDATES.find(p => fs.existsSync(p));
  if (!found) throw new Error('Chromium not found. In Termux: pkg install x11-repo && pkg install chromium');
  return found;
}

export const BROWSER_ARGS = [
  '--no-sandbox',
  '--disable-setuid-sandbox',
  '--disable-dev-shm-usage',
  '--disable-gpu',
  '--no-zygote',
  '--no-first-run',
  '--no-default-browser-check',
  '--mute-audio',
  '--lang=he-IL',
  // Termux-native Chromium: child processes cannot start under Android's linker
  // ("CANNOT LINK EXECUTABLE /proc/self/exe"), so everything runs in one process.
  ...(process.platform === 'android' || process.env.BALANCER_SINGLE_PROCESS ? ['--single-process'] : []),
];

// Termux's chromium-browser is a wrapper script that needs Termux's LD_PRELOAD (termux-exec);
// removing it makes the launch fail with exit code 126. Keep the environment as is.
export function browserEnv() {
  return { ...process.env };
}
