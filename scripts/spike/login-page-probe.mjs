// Phase 0: opens a provider's public login page and checks that the login
// form renders. It NEVER types or submits anything.
// Usage: node login-page-probe.mjs leumi|max|visaCal|discount|<https url>
import puppeteer from 'puppeteer-core';
import { SCRAPERS } from 'israeli-bank-scrapers-core';
import { findChromium, BROWSER_ARGS } from './browser-path.mjs';

// Login URLs as used inside israeli-bank-scrapers 6.12.x
const LOGIN_URLS = {
  leumi: 'https://www.leumi.co.il/he',
  max: 'https://www.max.co.il/login',
  visaCal: 'https://www.cal-online.co.il/',
  discount: 'https://start.telebank.co.il/login/#/LOGIN_PAGE',
};

const arg = process.argv[2] || 'max';
const url = LOGIN_URLS[arg] || arg;
if (!/^https:\/\//.test(url)) {
  console.error(`Unknown provider "${arg}". Use one of: ${Object.keys(LOGIN_URLS).join(', ')} or an https URL`);
  process.exit(2);
}
if (SCRAPERS[arg]) console.log(`${SCRAPERS[arg].name} needs fields: ${SCRAPERS[arg].loginFields.join(', ')}`);

const browser = await puppeteer.launch({ executablePath: findChromium(), headless: true, args: BROWSER_ARGS })
  .catch(e => { console.error('RESULT: FAIL - browser did not start:', e.message.split('\n')[0]); process.exit(1); });
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1024, height: 768 });
  const t0 = Date.now();
  await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });
  await new Promise(r => setTimeout(r, 3000)); // let SPA login widgets render
  let inputs = 0, passwords = 0;
  for (const frame of page.frames()) {
    try {
      inputs += await frame.$$eval('input', els => els.length);
      passwords += await frame.$$eval('input[type=password]', els => els.length);
    } catch { /* cross-origin frame that went away */ }
  }
  console.log(`loaded ${url} in ${Date.now() - t0} ms, title=${JSON.stringify(await page.title())}`);
  console.log(`inputs=${inputs} password-fields=${passwords} frames=${page.frames().length}`);
  console.log(inputs > 0 ? 'RESULT: login page renders (nothing was submitted)'
    : 'RESULT: page loaded but no inputs yet - the form may open behind a button; this is still a pass for browser/network');
} catch (e) {
  console.error('RESULT: FAIL -', e.message);
  process.exitCode = 1;
} finally {
  await browser.close();
}
