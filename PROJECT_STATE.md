# PROJECT_STATE — Balancer

## Current Focus
Phase 1 (foundations) is built and tested in the cloud: 34 tests pass, and the setup/unlock/lock screens were checked in headless Chromium.
Phase 1 runs on the phone (setup screen in Chrome).
OPEN BLOCKER from Phase 0: Debian Chromium crashes on the phone even without Puppeteer (`--dump-dom` → SIGTRAP; dbus/netlink errors are noise). The real crash line was not visible yet.
Next steps:
1. Path B (Termux-native Chromium) first run: Chromium child processes failed with "CANNOT LINK EXECUTABLE /proc/self/exe ... libtermux-exec.so" — Termux LD_PRELOAD. Fixed by launching Chromium without LD_PRELOAD (browserEnv() in scripts/spike/browser-path.mjs). Ron re-runs diagnose-native.sh.
2. If B fails: `bash scripts/spike/diagnose.sh` again; the new output shows only the crash lines.
3. Phase 2 (UI shell in Demo Mode) can start in parallel; the browser blocker must be solved before Phase 3 (UI shell in Demo Mode). The browser blocker must be solved before Phase 3.

## Ron's answers (2026-10-10)
- Device: Samsung Galaxy S25 FE, Android 16 → phantom-process fix: the Developer options toggle was not found on his Samsung; run checks first, fall back to adb-over-wireless-debugging from Termux if Chromium gets killed (signal 9).
- First institutions: Bank Leumi (bank), Visa Cal + Max (cards).
- SMS: the app must NOT read SMS messages (no SMS permission, no auto-read). If a site asks for a code, Ron types it himself.
- Browser profile: KEEP a persistent per-connection profile (`userDataDir`) so the bank asks for codes less often (Ron confirmed). If a site demands a code we can't handle, mark the connection `otp_required` and stop; never retry.
- Ron uses Chrome on Android. The UI (PWA) opens in his Chrome at http://127.0.0.1; the scraping uses a separate headless Chromium inside Termux/Debian (Puppeteer cannot drive the Chrome app, and keeping it separate avoids touching his personal browsing sessions).

## Decisions
- Server runs in native Termux Node (v26 there); only the scraper needs Debian + Chromium.
- Browser: proot-distro Debian + `apt install chromium` + NodeSource Node 22 (path A); Termux-native Chromium as fallback (B).
- Library: `israeli-bank-scrapers-core` 6.12.2 (requires Node >= 22.22.2), with `executablePath`.
- Storage: sql.js in memory; whole DB encrypted with AES-256-GCM on disk, written atomically.
- KDF: scrypt N=2^17 r=8 p=1 → KEK wraps a random data key.
- OTP: the library supports it only for One Zero; we keep a per-connection browser profile to avoid SMS prompts (Ron's choice).

## Phases
- [x] Phase 0: cloud checks (crypto, storage, Chromium launch, provider list), Termux setup script, report
- [ ] Phase 0: run on the phone — env OK, browser launch FAILED (socket hang up); diagnostics in scripts/spike/diagnose.sh
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
- [ ] Phase 2: UI shell in Demo Mode
- [ ] Phase 3: Scraper integration
- [ ] Phase 4: Intelligence
- [ ] Phase 5: Polish and hardening

## Open questions for Ron
1. Output of scripts/spike/diagnose.sh
2. Does Phase 1 run on the phone (install.sh + start.sh)?
3. (Optional) scrypt timings from phase0-results.txt
