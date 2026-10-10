// Runs one scrape in its own process, so a browser crash or memory spike never takes the
// server down. Credentials arrive over the IPC channel (never argv/env) and are never logged.
// stdout/stderr of this process are discarded by the parent.
import fs from 'node:fs';
import puppeteer from 'puppeteer-core';
import { createScraper } from 'israeli-bank-scrapers-core';
import { findChromium, BROWSER_ARGS, browserEnv } from './browser.js';

const send = msg => process.send?.(msg);

process.once('message', async job => {
  let browser;
  try {
    fs.mkdirSync(job.profileDir, { recursive: true, mode: 0o700 });
    browser = await puppeteer.launch({
      executablePath: findChromium(),
      headless: true,
      args: BROWSER_ARGS,
      env: browserEnv(),
      userDataDir: job.profileDir, // persistent per connection, so the bank recognizes the device
      timeout: 90_000,
      protocolTimeout: 180_000,
    });
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
    send({
      type: 'result',
      result: {
        success: Boolean(result.success),
        errorType: result.errorType || null,
        errorMessage: result.errorMessage || null,
        futureDebits: result.futureDebits || [],
        accounts: (result.accounts || []).map(a => ({
          accountNumber: String(a.accountNumber ?? ''),
          balance: typeof a.balance === 'number' ? a.balance : null,
          txns: (a.txns || []).map(({ rawTransaction, ...t }) => t),
        })),
      },
    });
  } catch (e) {
    send({ type: 'result', result: { success: false, errorType: 'WORKER_ERROR', errorMessage: String(e?.message || e) } });
  } finally {
    await browser?.close().catch(() => {});
    process.exit(0);
  }
});
