# Phase 0: Feasibility Report

Date: 2026-10-10
Status: **Conditional GO.** The cloud checks passed. The remaining gate is running the checks below on the phone.

## 1. Summary

| Question | Answer |
|---|---|
| Can `israeli-bank-scrapers` drive a browser we supply ourselves? | Yes. Use `israeli-bank-scrapers-core` with `executablePath`; it does not download Chrome. |
| Does Puppeteer + Chromium launch headless with the flags proot needs? | Yes in the cloud container (Chrome 141, ~350 ms, Hebrew renders). **Not yet tested on the phone.** |
| Storage that installs cleanly on Termux? | **sql.js** (pure WASM, no native build), kept in memory, and the whole DB file encrypted with AES-256-GCM on every save. |
| KDF? | **scrypt** from `node:crypto`, N=2^17, r=8, p=1 (tune after the phone benchmark). Argon2 is not in Node 22. |
| OTP / two-factor? | **Gap.** The library supports OTP only for One Zero. See section 5. |
| Biggest risk | Android's "phantom process killer" stopping Chromium mid-scrape (section 6). |

## 2. What was run in the cloud container

The cloud container (x64 Linux) cannot reach bank websites: its network policy blocks them. So I could prove the browser launches but not that a bank page loads.

| Check | Result |
|---|---|
| `npm run env`: scrypt N=2^15 / 2^16 / 2^17 | 150 / 209 / 454 ms |
| AES-256-GCM round trip | OK |
| `node:sqlite` | Works, but prints "experimental" in Node 22 and has no export/import API |
| sql.js: 20k fake transactions, then export + encrypt + decrypt + reload | 145 ms insert, 2.6 MB, 13 ms reload (50k rows: 7 MB, ~250 ms) |
| `npm run browser`: launch Chromium, render a Hebrew page | OK, Chrome/141, 348 ms |
| `npm run browser` / `npm run probe -- max`: load a website | Blocked by the cloud sandbox (`ERR_TUNNEL_CONNECTION_FAILED`). **Must run on the phone.** |
| Node version | The container has 22.22.0; the library requires **>= 22.22.2**. On the phone, install the current Node 22 (or newer). |

## 3. Findings from the reference repo (Shopping-list / Vplus)

- **Prior art:** `scripts/bank-sync/scraper.js` already runs `israeli-bank-scrapers` on GitHub Actions and writes to Firestore. It uses the same `--no-sandbox` flags and `PUPPETEER_EXECUTABLE_PATH`. Its `normalizeTxn` logic is useful: it handles Max's "סל מצטבר" type and imports unknown types as `normal` instead of dropping money. Balancer will reuse those ideas, but locally, with no Firebase and no cloud runner.
- **Design to reuse:** purple gradient `#7367f0 → #9055ff`, `lang="he" dir="rtl"`, card layout, toasts, bottom sheets, and the manifest/service worker structure.
- **Things not to copy:** Tailwind, Chart.js, SheetJS and PDF.js are loaded from CDNs at runtime, which breaks the "no CDN, offline, no leaks" rule. Balancer bundles every asset locally. The 12k-line `script.js` is a size to avoid; Balancer uses small ES modules.

## 4. The library (`israeli-bank-scrapers` 6.12.2, updated 2026-09-29)

- `israeli-bank-scrapers-core` is the same code built on `puppeteer-core`. It skips the bundled Chrome download, which has no Linux ARM64 build anyway.
- Results include `accounts[].txns`, `balance`, and **`futureDebits`**, which can feed the "upcoming card charges" screen directly.
- Each provider declares its own credential fields, so the connection form can be generated from them:

| Key | Name | Fields |
|---|---|---|
| hapoalim | Bank Hapoalim | userCode, password |
| leumi | Bank Leumi | username, password |
| mizrahi | Mizrahi Bank | username, password |
| discount | Discount Bank | id, password, num |
| mercantile | Mercantile Bank | id, password, num |
| otsarHahayal | Bank Otsar Hahayal | username, password |
| beinleumi | Beinleumi | username, password |
| massad | Massad | username, password |
| union | Union | username, password |
| yahav | Bank Yahav | username, nationalID, password |
| oneZero | One Zero | email, password, phoneNumber, otpCodeRetriever / otpLongTermToken |
| max | Max | username, password |
| visaCal | Visa Cal | username, password |
| isracard | Isracard | id, card6Digits, password |
| amex | Amex | id, card6Digits, password |
| beyahadBishvilha | Beyahad Bishvilha | id, password |
| behatsdaa | Behatsdaa | id, password |
| pagi | Pagi | username, password |

## 5. OTP / two-factor: proposed alternative

The spec asks for an OTP prompt in the UI. The library supports this **only for One Zero** (`otpCodeRetriever`). For every other provider, if the site asks for an SMS code, the scrape fails (usually `errorType: TIMEOUT` or `GENERIC`).

Proposal:
1. **One Zero:** full OTP flow as specified (UI prompt → `otpCodeRetriever`, then store the long-term token encrypted).
2. **Other providers:** keep a separate Chromium profile per connection (`userDataDir`), so the bank sees a "known device" and asks for OTP less often. When a scrape fails in a way that looks like OTP, mark the connection `otp_required` and offer a **"connect manually" run**: a visible browser window where Ron types the code himself, after which the profile is trusted. Running a visible window in proot needs an X server (Termux:X11), so this is a Phase 3 item to verify.
3. Tradeoff: a browser profile holds the bank's session cookies on disk. It sits in app-private Termux storage, but it is not encrypted by us. Alternatively we can wipe it after every scrape, which means more OTP prompts. **Your call** (see section 8).

## 6. Risks

1. **Phantom process killer (Android 12+).** Android kills background child processes beyond a limit of 32, and Chromium starts many. Fix, all from the phone:
   - Android 14+: Developer options → **"Disable child process restrictions"**.
   - Android 12–13: use Wireless debugging plus `pkg install android-tools` in Termux, `adb pair` / `adb connect` to the phone itself, then run `adb shell device_config set_sync_disabled_for_tests persistent; adb shell device_config put activity_manager max_phantom_processes 2147483647`.
   - Also run `termux-wake-lock` while scraping, and exempt Termux from battery optimization.
2. **Chromium under proot** is slower (expect 3–10 s launch) and some versions crash without `--no-zygote` or `--disable-dev-shm-usage`. Both flags are already set.
3. **Bot detection:** some banks fingerprint headless Chrome. The library already handles this for its supported providers; breakage means waiting for a library update.
4. **Memory:** headless Chromium plus a bank SPA uses about 300–600 MB. Scrapes run one at a time, never in parallel.
5. **Node version:** the library pins `>= 22.22.2`; Debian's own `nodejs` package is older, so the setup script uses NodeSource Node 22.
6. Standing risks from the spec (terms of service, scraper breakage, device security, lost master password) go into the README in Phase 1.

## 7. Decisions

**Browser path (in order):**
- **A, primary:** Termux → `proot-distro` Debian → `apt install chromium` + Node 22. Debian ships a maintained ARM64 Chromium, which is the most reliable option.
- **B, fallback:** Termux-native Chromium from Termux's X11 repo (`pkg install x11-repo && pkg install chromium`, then `CHROME_PATH=$PREFIX/bin/chromium-browser`). It is lighter than proot, but I could not confirm the package is current. Check with `pkg search chromium`.
- **C:** if both fail, stop and report, as the spec requires. The alternative to propose would be a native Android WebView extractor.

**Storage: sql.js plus whole-file encryption**
- No native compilation, so nothing like `better-sqlite3`/node-gyp can fail on Termux.
- The DB lives only in memory while unlocked. On disk it is a single AES-256-GCM blob (`data/balancer.db.enc`), written atomically (write to a temp file, fsync, rename). Nothing about the data, not even table names or row counts, is stored in plaintext.
- Real SQL for monthly aggregates, filters and dedupe.
- Size is fine: years of personal data is a few MB, and reload takes milliseconds.
- `node:sqlite` was rejected because, in Node 22, it is experimental and cannot export to or import from memory. It would need either a plaintext file on disk or per-field encryption, which leaves the table structure visible.

**Keys**
- Master password → scrypt (16-byte random salt per install) → KEK. KEK wraps a random 256-bit **data key**. Changing the password only re-wraps the data key.
- Credentials: each connection's blob is encrypted separately with its own random IV, inside the already-encrypted DB.
- Backup = the encrypted DB blob plus a header. Restore requires the master password.

## 8. Answers received (2026-10-10)

- Samsung Galaxy S25 FE, Android 16: use Developer options → **Disable child process restrictions**.
- First institutions: **Leumi**, **Visa Cal**, **Max**. All three log in with username + password.
- SMS: none wanted, so we **keep a per-connection browser profile**. If a site still asks for a code, the connection is marked `otp_required` and nothing is retried.
- A fresh Termux has no `git`. Use the bootstrap instead of the commands below:
  ```bash
  curl -fsSL https://raw.githubusercontent.com/ronmailx-boop/balancer/claude/new-session-dwvvzt/scripts/spike/bootstrap.sh -o b.sh && bash b.sh
  ```

## 9. Original questions

1. **Run on the phone** (Termux from F-Droid or GitHub):
   ```bash
   pkg install -y git
   git clone https://github.com/ronmailx-boop/balancer
   cd balancer && git checkout claude/new-session-dwvvzt
   bash scripts/spike/termux-setup.sh
   proot-distro login debian --bind "$PWD:/balancer" -- bash -c 'cd /balancer/scripts/spike && npm run env && npm run browser && npm run probe -- max'
   ```
   Paste the output. It contains no secrets: the probe only opens the login page and never types anything. If you want, also run `npm run probe -- visaCal` and `npm run probe -- discount`.
2. **Android version and phone model**, to choose the phantom-process fix.
3. **Which bank and which card** to build end to end first.
4. **OTP tradeoff (section 5.3):** keep a per-bank browser profile between scrapes (fewer SMS codes) or wipe it after each scrape (more SMS codes, nothing left on disk)?

After those, Phase 1 starts (repo scaffold, encrypted store, local server).
