# PROJECT_STATE — Balancer

## Current Focus
Phase 0 (feasibility) is done in the cloud and waiting on a run on the phone.
Next step: Ron runs `scripts/spike/termux-setup.sh` and the three checks (see `docs/phase0-feasibility.md` §8), pastes the output, and answers §8 items 2–4. Then Phase 1 starts.

## Decisions
- Browser: proot-distro Debian + `apt install chromium` + NodeSource Node 22 (path A); Termux-native Chromium as fallback (B).
- Library: `israeli-bank-scrapers-core` 6.12.2 (requires Node >= 22.22.2), with `executablePath`.
- Storage: sql.js in memory; whole DB encrypted with AES-256-GCM on disk, written atomically.
- KDF: scrypt N=2^17 r=8 p=1 → KEK wraps a random data key.
- OTP: the library supports it only for One Zero; for others use a per-connection browser profile and a manual "connect" run (pending Ron's decision).

## Phases
- [x] Phase 0: cloud checks (crypto, storage, Chromium launch, provider list), Termux setup script, report
- [ ] Phase 0: run on the phone (Ron)
- [ ] Phase 1: Foundations (scaffold, encrypted store, local server, schema)
- [ ] Phase 2: UI shell in Demo Mode
- [ ] Phase 3: Scraper integration
- [ ] Phase 4: Intelligence
- [ ] Phase 5: Polish and hardening

## Open questions for Ron
1. Phone check output
2. Android version and phone model
3. First bank + first card
4. Keep or wipe the per-bank browser profile between scrapes
