// Phase 0 diagnostics: Chromium starts but the DevTools socket hangs up.
// Tries several flag sets and prints Chromium's own stderr for each.
// Opens only a local data: page. Usage: node diagnose-browser.mjs
import fs from 'node:fs';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import puppeteer from 'puppeteer-core';
import { findChromium, BROWSER_ARGS } from './browser-path.mjs';

const exe = findChromium();
const osRelease = fs.existsSync('/etc/os-release')
  ? (fs.readFileSync('/etc/os-release', 'utf8').match(/PRETTY_NAME="([^"]+)"/) || [])[1]
  : 'unknown';
console.log(`node ${process.version} ${os.arch()} | os: ${osRelease} | kernel ${os.release()}`);
console.log(`chromium: ${exe}`);
const ver = spawnSync(exe, ['--version'], { encoding: 'utf8' });
console.log(`version: ${(ver.stdout || ver.stderr || String(ver.error)).trim()}`);

// 1) Chromium alone, no Puppeteer
const direct = spawnSync(exe, [...BROWSER_ARGS, '--headless', '--dump-dom', 'data:text/html,<p>ok</p>'],
  { encoding: 'utf8', timeout: 60000 });
const directOk = (direct.stdout || '').includes('<p>ok</p>');
console.log(`\n[direct --dump-dom] ${directOk ? 'OK' : 'FAIL'} exit=${direct.status} signal=${direct.signal}`);
if (!directOk) console.log(tail(direct.stderr));

// 2) Puppeteer with different flag sets
const SETS = {
  base: BROWSER_ARGS,
  singleProcess: [...BROWSER_ARGS, '--single-process'],
  noFeatures: [...BROWSER_ARGS, '--single-process', '--disable-features=VizDisplayCompositor,dbus', '--disable-software-rasterizer', '--disable-crash-reporter', '--disable-breakpad', '--no-default-browser-check'],
  pipe: BROWSER_ARGS, // CDP over a pipe instead of a WebSocket
};
for (const [name, args] of Object.entries(SETS)) {
  let stderr = '';
  let browser;
  try {
    browser = await puppeteer.launch({
      executablePath: exe, headless: true, args, pipe: name === 'pipe',
      dumpio: false, timeout: 60000, protocolTimeout: 60000,
    });
    browser.process()?.stderr?.on('data', d => { stderr += d; });
    const page = await browser.newPage();
    await page.goto('data:text/html,<meta charset=utf-8><h1>שלום</h1>');
    console.log(`\n[puppeteer ${name}] OK - ${await page.$eval('h1', e => e.textContent)}`);
  } catch (e) {
    console.log(`\n[puppeteer ${name}] FAIL - ${e.message.split('\n')[0]}`);
    if (stderr) console.log(tail(stderr));
  } finally {
    await browser?.close().catch(() => {});
  }
}

function tail(s = '', n = 8) {
  return s.trim().split('\n').slice(-n).map(l => '    ' + l.slice(0, 160)).join('\n');
}
