// Phase 0: proves puppeteer-core can launch Chromium and render Hebrew.
// Harmless targets only. Usage: node launch-browser.mjs [https://example.com]
import puppeteer from 'puppeteer-core';
import { findChromium, BROWSER_ARGS } from './browser-path.mjs';

const executablePath = findChromium();
console.log('chromium:', executablePath);
const t0 = Date.now();
const browser = await puppeteer.launch({ executablePath, headless: true, args: BROWSER_ARGS })
  .catch(e => { console.error('RESULT: FAIL - browser did not start:', e.message.split('\n')[0]); process.exit(1); });
try {
  console.log('launched:', await browser.version(), `${Date.now() - t0} ms`);
  const page = await browser.newPage();
  await page.goto('data:text/html,<meta charset=utf-8><html dir=rtl><h1>שלום Balancer</h1></html>');
  console.log('local page:', await page.$eval('h1', el => el.textContent));
  const url = process.argv[2] || 'https://example.com';
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
  console.log('network page:', url, '->', JSON.stringify(await page.title()));
  console.log('RESULT: browser OK');
} catch (e) {
  console.error('RESULT: FAIL -', e.message);
  process.exitCode = 1;
} finally {
  await browser.close();
}
