# Security design (Phase 1)

## Keys
- Master password → **scrypt** (N=2^17, r=8, p=1, 16-byte random salt per install) → 256-bit key-encryption key (KEK).
- A random 256-bit **data key** is generated once and stored only wrapped by the KEK (AES-256-GCM), in `data/vault.json`.
- Changing the password re-wraps the data key; data is not re-encrypted.
- The master password is never stored or logged. The KEK is zeroed right after use. The data key lives in memory only while the vault is unlocked, and is zeroed on lock.
- No recovery: losing the master password means losing the data. This is by design.

## Data at rest
- The whole SQLite database (sql.js, in memory) is encrypted as one AES-256-GCM blob in `data/db.enc`. A fresh random IV is used on every save. Nothing is in plaintext on disk, not even table names.
- Writes are atomic (temp file, fsync, rename), files are created with mode 600, and `data/` with mode 700.
- Bank credentials (Phase 3) are additionally sealed per record (`vault.sealField`) with their own IV and the connection id as AAD.
- AAD labels (`balancer:data-key:v1`, `balancer:db:v1`) bind each ciphertext to its purpose.

## Local server
- Listens on `127.0.0.1` only.
- The `Host` header must be `127.0.0.1:<port>` or `localhost:<port>` (blocks DNS rebinding).
- API is same-origin only: a foreign `Origin` or `Sec-Fetch-Site: cross-site` gets 403, and no CORS headers are ever sent. POST bodies must be JSON (blocks plain HTML form CSRF). Bodies are capped at 64 KB.
- Each unlock creates a random 256-bit session token; only its SHA-256 is kept and it is compared in constant time. Lock, auto-lock and a new unlock all invalidate it. The PWA keeps it in `sessionStorage`.
- Unlock is throttled: after the n-th consecutive failure the next attempt waits 2^(n-1) s (max 15 min), even with the correct password. Only one unlock runs at a time.
- Auto-lock after 5 minutes without an authenticated request (`BALANCER_IDLE_MINUTES`).
- Strict CSP (`default-src 'self'`, no inline scripts or styles, no external hosts), `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`, `nosniff`, COOP/CORP same-origin, restrictive `Permissions-Policy`. API responses are `no-store`.

## Hygiene
- Dev logs are English, never include request bodies, and pass metadata through `redact()` (secret-looking keys removed, digit runs masked to the last 4).
- `scripts/secret-scan.mjs` runs as a pre-commit hook. It blocks data/backup/key files, common token formats, hard-coded passwords, and Luhn-valid card numbers.
- Only one runtime dependency (`sql.js`), pinned.
