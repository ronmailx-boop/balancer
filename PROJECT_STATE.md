# PROJECT_STATE — Balancer

## Current Focus
Phase 0 is complete: Ron ran the bootstrap on the phone (S25 FE, Android 16) on 2026-10-10 and reported all checks passed. Decision: GO.
Next step: get Ron's approval for the Phase 1 plan, then build it. Optional: Ron pastes `~/balancer/phase0-results.txt` so the scrypt cost can be tuned to the phone's timing (default N=2^17).

## Ron's answers (2026-10-10)
- Device: Samsung Galaxy S25 FE, Android 16 → phantom-process fix: the Developer options toggle was not found on his Samsung; run checks first, fall back to adb-over-wireless-debugging from Termux if Chromium gets killed (signal 9).
- First institutions: Bank Leumi (bank), Visa Cal + Max (cards).
- SMS: the app must NOT read SMS messages (no SMS permission, no auto-read). If a site asks for a code, Ron types it himself.
- Browser profile: KEEP a persistent per-connection profile (`userDataDir`) so the bank asks for codes less often (Ron confirmed). If a site demands a code we can't handle, mark the connection `otp_required` and stop; never retry.
- Ron uses Chrome on Android. The UI (PWA) opens in his Chrome at http://127.0.0.1; the scraping uses a separate headless Chromium inside Termux/Debian (Puppeteer cannot drive the Chrome app, and keeping it separate avoids touching his personal browsing sessions).

## Decisions
- Browser: proot-distro Debian + `apt install chromium` + NodeSource Node 22 (path A); Termux-native Chromium as fallback (B).
- Library: `israeli-bank-scrapers-core` 6.12.2 (requires Node >= 22.22.2), with `executablePath`.
- Storage: sql.js in memory; whole DB encrypted with AES-256-GCM on disk, written atomically.
- KDF: scrypt N=2^17 r=8 p=1 → KEK wraps a random data key.
- OTP: the library supports it only for One Zero; we keep a per-connection browser profile to avoid SMS prompts (Ron's choice).

## Phases
- [x] Phase 0: cloud checks (crypto, storage, Chromium launch, provider list), Termux setup script, report
- [x] Phase 0: run on the phone (Ron) — all checks passed
- [ ] Phase 1: Foundations (scaffold, encrypted store, local server, schema)
- [ ] Phase 2: UI shell in Demo Mode
- [ ] Phase 3: Scraper integration
- [ ] Phase 4: Intelligence
- [ ] Phase 5: Polish and hardening

## Open questions for Ron
1. Approve the Phase 1 plan
2. (Optional) `phase0-results.txt` numbers for scrypt tuning
