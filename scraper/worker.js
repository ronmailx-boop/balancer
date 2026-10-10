// Runs one scrape in its own process, so a browser crash or memory spike never takes the
// server down. Credentials arrive over the IPC channel (never argv/env) and are never logged.
// stdout/stderr of this process are discarded by the parent.
import fs from 'node:fs';
import path from 'node:path';
import puppeteer from 'puppeteer-core';
import { createScraper } from 'israeli-bank-scrapers-core';
import { findChromium, BROWSER_ARGS, browserEnv } from './browser.js';

const send = msg => process.send?.(msg);
let browser;
let finished = false;

async function finish(result) {
  if (finished) return;
  finished = true;
  if (result) send({ type: 'result', result });
  await browser?.close().catch(() => {});
  process.exit(0);
}

const fail = (errorType, e) => finish({ success: false, errorType, errorMessage: `${e?.name || 'Error'}: ${String(e?.message || e).slice(0, 300)}` });

// A Chromium left over from a killed sync keeps the profile locked, and the next launch fails.
// Only a process whose command line names this exact profile directory is stopped.
function releaseProfile(profileDir) {
  let target;
  try { target = fs.readlinkSync(path.join(profileDir, 'SingletonLock')); } catch { return; }
  const pid = Number(String(target).split('-').pop());
  if (!Number.isInteger(pid) || pid <= 1 || pid === process.pid) return;
  try {
    const cmd = fs.readFileSync(`/proc/${pid}/cmdline`, 'utf8');
    if (cmd.includes(profileDir)) process.kill(pid, 'SIGKILL');
  } catch { /* not running */ }
  for (const f of ['SingletonLock', 'SingletonSocket', 'SingletonCookie']) fs.rmSync(path.join(profileDir, f), { force: true });
}

process.on('uncaughtException', e => fail('WORKER_ERROR', e));
process.on('unhandledRejection', e => fail('WORKER_ERROR', e));

process.on('message', async job => {
  if (job?.type === 'abort') return finish(null); // parent timed out: close the browser cleanly
  if (browser || finished) return;
  try {
    fs.mkdirSync(job.profileDir, { recursive: true, mode: 0o700 });
    releaseProfile(job.profileDir);
    browser = await puppeteer.launch({
      executablePath: findChromium(),
      headless: true,
      args: BROWSER_ARGS,
      env: browserEnv(),
      userDataDir: job.profileDir, // persistent per connection, so the bank recognizes the device
      timeout: 90_000,
      protocolTimeout: 180_000,
    });
  } catch (e) {
    return fail('LAUNCH_ERROR', e);
  }
  try {
    const scraper = createScraper({
      companyId: job.provider,
      startDate: new Date(job.startDate),
      browser,
      skipCloseBrowser: true,
      combineInstallments: false,
      futureMonthsToScrape: 1,
      defaultTimeout: 90_000,
      timeout: 90_000,
      // Hide "HeadlessChrome" (bot filters). Providers that set their own User-Agent override this.
      preparePage: async page => {
        const ua = (await browser.userAgent()).replace('HeadlessChrome/', 'Chrome/');
        await page.setUserAgent(ua);
      },
    });
    scraper.onProgress((_, { type }) => send({ type: 'progress', stage: type }));
    // The scrape must not be retried on failure: a wrong password retried can lock the account.
    const result = await scraper.scrape(job.credentials);
    job.credentials = null;
    // Plain JSON copy: whatever the library returns, the IPC message can always be serialized
    await finish(JSON.parse(JSON.stringify({
      success: Boolean(result.success),
      errorType: result.errorType || null,
      errorMessage: result.errorMessage || null,
      accounts: (result.accounts || []).map(a => ({
        accountNumber: String(a.accountNumber ?? ''),
        balance: typeof a.balance === 'number' ? a.balance : null,
        txns: (a.txns || []).map(({ rawTransaction, ...t }) => t),
      })),
    })));
  } catch (e) {
    fail('WORKER_ERROR', e);
  }
});
