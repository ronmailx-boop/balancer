# Security review (Phase 5)

Checked against section 2 of `MASTER_PROMPT.md` on 2026-10-10. Details of the design are in `security.md`.

| Requirement | Status | Where |
|---|---|---|
| Credentials only on the device, encrypted at rest | Done | `server/vault.js` `sealField`, inside the encrypted DB |
| AES-256-GCM, unique random IV per record | Done | `server/crypto.js` (12-byte random IV on every encrypt) |
| Key from master password with a strong KDF, per-install salt | Done | scrypt N=2^17 r=8 p=1, 16-byte salt; KDFs weaker than N=2^14 are rejected |
| Master password never stored | Done | only the wrapped data key is stored |
| Decrypt credentials only in memory, only for a scrape | Done | `server/sync.js` opens them per sync and sends them to the worker over IPC |
| Biometric / WebAuthn unlock (optional) | Not built | optional in the spec; the master password stays the only key |
| Transaction DB encrypted at rest | Done | whole DB as one AES-GCM blob, new IV per save |
| Encrypted backup / restore, user-initiated, to a file the user chooses | Done | Settings → גיבוי ושחזור; never automatic, never uploaded |
| Bind 127.0.0.1 only | Done | `server/index.js`; test `listens on 127.0.0.1 only` |
| Per-session random token on every API call | Done | 256-bit token, SHA-256 kept, constant-time compare |
| Strict same-origin, no CORS | Done | Host, Origin and Sec-Fetch-Site checks; JSON-only POST |
| Rate-limited unlock with increasing delay | Done | `server/ratelimit.js`; also applies to restore and wipe |
| Restrictive headers and strict CSP | Done | no inline scripts/styles, no external hosts |
| No CDN scripts or fonts | Done | everything is served from `app/`; works offline |
| Never log credentials, tokens, OTPs, full account numbers, bank HTML | Done | `server/log.js` redacts keys and masks digit runs; worker output discarded |
| Mask account numbers (last 4) | Done | `shared/normalize.js` stores only the last 4 digits |
| Redact secrets from error messages | Done | only error types are logged by default; library messages need `BALANCER_SCRAPER_DEBUG=1` and are digit-masked |
| `.gitignore` excludes DBs, backups, `.env`, keys, debug output | Done | plus the pre-commit secret scan blocks those files |
| Pre-commit secret check | Done | `.githooks/pre-commit` → `scripts/secret-scan.mjs` |
| Pinned, few, documented dependencies | Done | 3 runtime dependencies, exact versions, reasons in README |
| Never auto-retry login after a credential error | Done | `needs_attention`, manual sync refused until new credentials; tested |
| Throttle scrapes, user-initiated | Done | one at a time, 5-minute minimum per connection, 6-minute timeout |
| OTP flow | Partial | the library supports OTP only for One Zero (not used). A code request marks the connection `otp_required`; a persistent browser profile makes codes rare. SMS is never read (Ron's choice). |

## Other checks in this review
- XSS: all bank and user text is rendered with `textContent` (`app/ui.js` `h()`); there is no `innerHTML` with data. Inputs are cleaned (`cleanText`) before storage.
- CSV export escapes spreadsheet formulas.
- Path traversal on static files is blocked (tested).
- Sheets make the page behind them inert, so focus cannot reach hidden controls.
- The Max scraper is patched locally (`scripts/patch-scrapers.mjs`) so an unknown plan name does not fail the whole sync; the patch only changes how a plan is classified.

## Known limits
- Security depends on the phone: screen lock, no root, no untrusted apps, device encryption on.
- Browser profiles (`data/profiles`) keep bank cookies unencrypted (mode 700), as Ron accepted, so banks ask for codes less often.
- Any app on the phone that can reach `127.0.0.1:8765` can try to unlock; the backoff and the strong KDF limit guessing.
