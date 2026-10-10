# PROJECT_STATE — Balancer

## Current Focus
Phase 3 on the phone: Leumi and Cal synced OK. Max failed with WORKER_ERROR (that label used to cover any worker failure).
Fix 7f7d16b splits it into LAUNCH_ERROR / WORKER_ERROR / WORKER_EXIT (killed by Android), logs the short reason
to Termux by default, releases a stale Chromium profile lock, and lets the worker close its browser on timeout.
Next: Ron runs `git pull`, restarts, syncs Max again and sends the error card plus the `WARN sync max` Termux line.

## Browser history (Phase 0)
- Path A (proot Debian Chromium) crashes on the S25 FE with SIGTRAP even without Puppeteer. Dropped.
- Path B (Termux-native `chromium-browser`): multi-process fails ("CANNOT LINK EXECUTABLE /proc/self/exe ... libtermux-exec.so"); `--single-process` works.
- Removing LD_PRELOAD was wrong: the wrapper then exits with 126. Keep LD_PRELOAD.
- Always hide "HeadlessChrome" in the User-Agent (the library does it; Cal's WAF rejects it).

## Ron's answers (2026-10-10)
- Device: Samsung Galaxy S25 FE, Android 16 → phantom-process fix: the Developer options toggle was not found on his Samsung; run checks first, fall back to adb-over-wireless-debugging from Termux if Chromium gets killed (signal 9).
- First institutions: Bank Leumi (bank), Visa Cal + Max (cards).
- SMS: the app must NOT read SMS messages (no SMS permission, no auto-read). If a site asks for a code, Ron types it himself.
- Browser profile: KEEP a persistent per-connection profile (`userDataDir`) so the bank asks for codes less often (Ron confirmed). If a site demands a code we can't handle, mark the connection `otp_required` and stop; never retry.
- Ron uses Chrome on Android. The UI (PWA) opens in his Chrome at http://127.0.0.1; the scraping uses a separate headless Chromium inside Termux/Debian (Puppeteer cannot drive the Chrome app, and keeping it separate avoids touching his personal browsing sessions).

## Decisions
- Charts: hand-written SVG. Income #2a78d6 / expenses #eb6834 (dark #3987e5 / #d95926), magnitude bars brand purple; validated with the dataviz palette validator. Budget status = status color + icon + text label.
- Money signs: transactions.charged_amount negative = expense; card_charges.amount positive = amount to be debited.
- Installments count in their charge month (processed_date); card bills on the bank are 'transfer' (not counted twice).
- Fixed categories at 100% of budget are "on plan" (no warning).
- Server runs in native Termux Node (v26 there); only the scraper needs Debian + Chromium.
- Browser: path B — Termux-native Chromium (`pkg install x11-repo chromium`) with `--single-process`; keep Termux's LD_PRELOAD (removing it → exit 126). Path A (Debian/proot Chromium) crashes on the S25 FE (SIGTRAP) and is dropped.
- Library: `israeli-bank-scrapers-core` 6.12.2 (requires Node >= 22.22.2), with `executablePath`.
- Storage: sql.js in memory; whole DB encrypted with AES-256-GCM on disk, written atomically.
- KDF: scrypt N=2^17 r=8 p=1 → KEK wraps a random data key.
- OTP: the library supports it only for One Zero; we keep a per-connection browser profile to avoid SMS prompts (Ron's choice).

## Phases
- [x] Phase 0: cloud checks (crypto, storage, Chromium launch, provider list), Termux setup script, report
- [x] Phase 0: run on the phone — browser OK (Termux-native, single-process), Leumi / Max / Cal login pages render
- [x] Phase 1: Foundations
  - [x] Scaffold, package.json, .env.example, README with dependency reasons and risks
  - [x] Termux scripts: scripts/install.sh, scripts/start.sh
  - [x] Secret scan (scripts/secret-scan.mjs) + pre-commit hook (.githooks)
  - [x] Crypto: scrypt KDF + AES-256-GCM (server/crypto.js)
  - [x] Vault: create/unlock/lock/change password, wrapped data key, whole-DB encryption, per-field sealing (server/vault.js)
  - [x] Schema + migrations (shared/migrations.js, server/db.js)
  - [x] Local server: 127.0.0.1, Host/Origin checks, session token, unlock backoff, auto-lock, CSP (server/app.js)
  - [x] Minimal Hebrew RTL screens: setup / unlock / home / change password (app/)
  - [x] Tests (tests/*.test.js)
  - [x] Ron checks it on the phone (setup screen renders in Chrome, dark mode)
- [x] Phase 2: UI shell in Demo Mode (built and checked in headless Chromium, light + dark; waiting for Ron's check on the phone)
  - [x] Demo data generator (shared/demo.js): Leumi + Max + Cal, 7 months, salary, rent, bills, subscriptions, installments, pending, USD, two billing dates
  - [x] Demo isolation: separate in-memory DB, never saved; toggle in Settings; banner
  - [x] Default Hebrew categories + starter rules for Israeli merchants (shared/categories.js), rules engine (shared/categorize.js)
  - [x] Data API + read models (server/queries.js): overview, month, transactions (filters/search), update, budget (+copy), trends, projection, recurring/installments, CSV export
  - [x] Screens: home, monthly, transactions (search, filters, day groups, detail sheet), budget, more, trends, recurring, accounts, settings
  - [x] Charts in plain SVG (app/charts.js), colors validated for color-vision deficiency
  - [x] Month picker + swipe, pull-to-refresh (reload), skeletons, toasts, bottom sheet
  - [x] PWA: manifest, icons, service worker (offline shell; API never cached)
  - [ ] Ron checks on the phone
- [x] Phase 3: Scraper integration (built and tested in the cloud with fake data; first real sync is Ron's)
  - [x] scraper/worker.js: separate process, Termux Chromium, persistent profile per connection, credentials over IPC
  - [x] scraper/providers.js: Leumi, Cal, Max first + the rest, Hebrew field labels (no One Zero)
  - [x] shared/normalize.js: Israeli calendar dates, masked numbers, stable ids, pending, installments, card bills
  - [x] server/merge.js: upsert, pending -> posted reconciliation keeping user edits, rule categorization
  - [x] server/sync.js: one at a time, 5-min throttle, 6-min timeout, error -> status, never auto-retry credential errors
  - [x] API: providers, connections (add/update/delete), sync, sync status
  - [x] UI: accounts screen (add, edit, delete, sync now, progress, Hebrew errors), pull-to-refresh on home syncs all
  - [x] Tests with recorded-shape fake fixtures (tests/fixtures/scrapes.js)
  - [ ] Ron: first real sync of Leumi, then Cal and Max
- [ ] Phase 4: Intelligence
- [ ] Phase 5: Polish and hardening

## Open questions for Ron
1. Output of scripts/spike/diagnose.sh
2. Does Phase 1 run on the phone (install.sh + start.sh)?
3. (Optional) scrypt timings from phase0-results.txt
