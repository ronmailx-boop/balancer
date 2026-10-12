# PROJECT_STATE — Balancer

## Current Focus
Phase 5 (polish and hardening) is built: 82 tests pass, screens checked in headless Chromium.
Next: Ron runs `cd ~/balancer && git pull && bash scripts/install.sh` once (installs the `balancer` command), then:
1. Settings -> גיבוי ושחזור -> download a backup and save it off the phone.
2. Optional: Termux:Widget app -> Balancer icon on the home screen.
3. Settings -> auto-lock minutes.
After that the planned phases are complete; further work is by Ron's requests.

## Browser history (Phase 0)
- Path A (proot Debian Chromium) crashes on the S25 FE with SIGTRAP even without Puppeteer. Dropped.
- Path B (Termux-native `chromium-browser`): multi-process fails ("CANNOT LINK EXECUTABLE /proc/self/exe ... libtermux-exec.so"); `--single-process` works.
- Removing LD_PRELOAD was wrong: the wrapper then exits with 126. Keep LD_PRELOAD.
- Always hide "HeadlessChrome" in the User-Agent (the library does it; Cal's WAF rejects it).

## Auto sync (2026-10-10, Ron's request)
- Twice a day when the app is opened: a 07:00 slot and a 19:00 slot (Israel time; 00:00-06:59 belongs to the previous evening). server/autosync.js; triggered from GET /api/overview (home screen), only when unlocked and not in demo.
- Each slot runs at most once even if it fails (settings.auto_sync_slot); connections synced by hand in the slot, or needing attention, are skipped. Toggle: Settings -> סנכרון אוטומטי (settings.auto_sync, default on).

## Keeping the server up (2026-10-12)
- Android kills Termux in the background, so the app showed "השרת המקומי לא פועל". install.sh now adds: a ~/.bashrc block that starts Balancer when Termux opens (if not running), a Termux:Boot script (~/.termux/boot/balancer, background, no browser, log in data/server.log), and `balancer stop`; `balancer update` restarts a running server. Since 2026-10-12 the Termux autostart and `balancer update` run the server in the background (`balancer bg`, log in data/server.log, `balancer log`), so the session stays free for commands.

## Month breakdown (2026-10-12, Ron's request)
- Tapping הכנסות / הוצאות / נשאר (home and monthly screens) opens a sheet (app/views/flow.js, GET /api/month/flow = Q.monthFlow): totals by category and every counted movement; נשאר shows the calculation, what is not counted (card bills/transfers, excluded) and how "תקציב החודש" differs (only budgeted categories).

- 2026-10-12: Ron asked to remove the autostart on opening Termux (the old version held the session, so typed commands went nowhere). install.sh now deletes the ~/.bashrc block. Start with `balancer`; `balancer auto` (update + start in background) stays available by hand.

## Rolling credit (2026-10-12, Ron's request)
- Cards with "אשראי מתגלגל": a fixed monthly payment leaves the bank, the rest rolls over. server/rolling.js: settings.card_fixed_payments {cardId: {amount, source auto|user}}; detection after each sync and on unlock from bank card_payment debits (provider words; with several cards of one company the debit must contain the card's last 4 digits) that stay about the same while the card bill was larger.
- Upcoming charges, projection, the low-balance alert and the account card use the fixed amount; the bill sheet shows total / debit / rolled and a "שינוי" editor (amount, 0 = none, null = back to detection).
- Unknown: whether Leumi's debit text includes the card digits. If not, Ron's two Cal cards are not detected and he sets them by hand.

## Launcher
- The apps launcher (repo my-site, https://apps.vplusstudio.app/) has a balancer tile that opens http://127.0.0.1:8765/#/home (my-site PR #46, Ron confirmed it works). The tile's icon is a copy of app/icon-512.png kept in my-site (icons/balancer-512.png); if the icon changes, update it there too.

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
  - [x] Ron checks on the phone (uses it daily with real data)
- [x] Phase 3: Scraper integration (verified on the phone: Leumi, Cal and Max all sync)
  - [x] scraper/worker.js: separate process, Termux Chromium, persistent profile per connection, credentials over IPC
  - [x] scraper/providers.js: Leumi, Cal, Max first + the rest, Hebrew field labels (no One Zero)
  - [x] shared/normalize.js: Israeli calendar dates, masked numbers, stable ids, pending, installments, card bills
  - [x] server/merge.js: upsert, pending -> posted reconciliation keeping user edits, rule categorization
  - [x] server/sync.js: one at a time, 5-min throttle, 6-min timeout, error -> status, never auto-retry credential errors
  - [x] API: providers, connections (add/update/delete), sync, sync status
  - [x] UI: accounts screen (add, edit, delete, sync now, progress, Hebrew errors), pull-to-refresh on home syncs all
  - [x] Tests with recorded-shape fake fixtures (tests/fixtures/scrapes.js)
  - [x] Ron: first real sync of Leumi, Cal and Max (2026-10-10; Max needed the unknown-plan patch)
- [x] Phase 4: Intelligence (verified on the phone with real data)
  - [x] Migration v2: transaction_splits; recurring_items gets merchant_key, account_id, category_id, last/previous amount, occurrences, source
  - [x] Recurring detection (shared/recurring.js): per account + merchant key, weekly/monthly/bimonthly/yearly, same-day check, amount spread; runs after sync, on unlock, in demo; "not recurring" kept in settings.recurring_dismissed
  - [x] Alerts: price rise (fixed-price items only), expected charge/income missing, possible double charge; critical first
  - [x] Split transaction (POST /api/transactions/split): sums use COUNTED_TX (parts replace the whole); not for pending or transfers
  - [x] Categories and rules screen (#/categories): custom categories (u- ids), built-in type locked, user rules add/delete with re-categorization
  - [x] Insights on home: variable-spending pace vs 3-cycle average, categories over average, monthly recurring total
  - [x] Recurring screen rebuilt on real detection (income / expenses / stopped, detail sheet, dismiss)
  - [x] Ron checks on the phone with real data (2026-10-10: all works)
- [x] Phase 5: Polish and hardening (built and tested in the cloud; waiting for Ron's check on the phone)
  - [x] Overdrawn bank balance shown in red (white chip on the purple card), negative account balances red
  - [x] Encrypted backup download, restore (fresh install or Settings), full wipe with password; restore/wipe share the unlock backoff
  - [x] Auto-lock minutes in Settings (1-60, settings.idle_minutes)
  - [x] `balancer` / `balancer update` command and a Termux:Widget home-screen shortcut (install.sh); start.sh just opens the app if it is already running
  - [x] Performance: migration v3 indexes, trends no longer recomputes per category; perf test with ~25k transactions
  - [x] Accessibility: page behind a sheet is inert
  - [x] Fixed: visibilitychange handler re-registered the service worker instead of re-checking the lock
  - [x] Security review (docs/security-review.md), security.md and README updated; backups blocked by .gitignore and the secret scan
  - [ ] Ron checks on the phone

## Open questions for Ron
1. Output of scripts/spike/diagnose.sh
2. Does Phase 1 run on the phone (install.sh + start.sh)?
3. (Optional) scrypt timings from phase0-results.txt
