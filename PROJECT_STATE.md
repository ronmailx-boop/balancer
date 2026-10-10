# PROJECT_STATE — Balancer

## Current Focus
Phase 0 is waiting on the phone run. The first attempt failed because git was missing on a fresh Termux, so we added a one-command bootstrap:
`curl -fsSL https://raw.githubusercontent.com/ronmailx-boop/balancer/claude/new-session-dwvvzt/scripts/spike/bootstrap.sh -o b.sh && bash b.sh`
Next step: Ron runs it and pastes `~/balancer/phase0-results.txt`. Then Phase 1 starts.

## Ron's answers (2026-10-10)
- Device: Samsung Galaxy S25 FE, Android 16 → phantom-process fix = Developer options → "Disable child process restrictions".
- First institutions: Bank Leumi (bank), Visa Cal + Max (cards).
- SMS: he wants no SMS codes at all → keep a persistent per-connection browser profile (`userDataDir`) so the device stays "known". If a site still demands a code, mark the connection `otp_required` and stop; never retry.

## Decisions
- Browser: proot-distro Debian + `apt install chromium` + NodeSource Node 22 (path A); Termux-native Chromium as fallback (B).
- Library: `israeli-bank-scrapers-core` 6.12.2 (requires Node >= 22.22.2), with `executablePath`.
- Storage: sql.js in memory; whole DB encrypted with AES-256-GCM on disk, written atomically.
- KDF: scrypt N=2^17 r=8 p=1 → KEK wraps a random data key.
- OTP: the library supports it only for One Zero; we keep a per-connection browser profile to avoid SMS prompts (Ron's choice).

## Phases
- [x] Phase 0: cloud checks (crypto, storage, Chromium launch, provider list), Termux setup script, report
- [ ] Phase 0: run on the phone (Ron)
- [ ] Phase 1: Foundations (scaffold, encrypted store, local server, schema)
- [ ] Phase 2: UI shell in Demo Mode
- [ ] Phase 3: Scraper integration
- [ ] Phase 4: Intelligence
- [ ] Phase 5: Polish and hardening

## Open questions for Ron
1. Phone check output (`phase0-results.txt`)
