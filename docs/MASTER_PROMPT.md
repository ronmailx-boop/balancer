# Balancer — Master Prompt for Claude Code

You are building **Balancer**, a personal-only finance app for a single user (Ron). It connects to his own Israeli bank accounts and credit cards, pulls transactions and balances, and presents them in a polished UI modeled on **RiseUp** (the Israeli budgeting app). Everything runs **locally on his Android phone**. Nothing is sent to any cloud service.

Read this whole document before writing code. Work in phases, and stop at the end of each phase for review.

---

## 0. Context and hard constraints

- **The developer works only from an Android phone.** There is no computer. Every instruction, script and setup step must be runnable from Termux / Claude Code on mobile. Never tell him to "run this on your laptop".
- **Personal use only.** One user, one device. No multi-user, no sign-up, no server-side accounts.
- **Privacy is the top requirement.** All credentials and all financial data stay on the device. No Firebase, no Render, no analytics, no telemetry, no external logging, no third-party SDKs that phone home.
- **UI language:** Hebrew, RTL, mobile-first. Code, comments, commit messages and README in English.
- **Theme:** purple, primary `#7367f0`, secondary `#7c4ddb`. Clean, modern, card-based. Match the visual language of his existing projects.
- **Preferred delivery:** PWA. A native Android wrapper (TWA/APK) is optional and only considered later.
- **Never ask for, print, log or commit real bank credentials.** Use fake data for all development and tests (see Demo Mode).

### Reference project (inspiration only)

Study https://github.com/ronmailx-boop/Shopping-list for:
- Folder and file conventions, naming, code style
- Mobile-first RTL Hebrew layout patterns
- PWA setup: manifest, service worker, install prompt
- Purple theme, component styling, bottom-sheet and modal patterns
- How budgets and lists are presented

Do **not** copy its Firebase dependencies, cloud sync or auth. Balancer is fully local. Reuse only design and UX ideas.

---

## 1. Architecture

Three local parts on one phone:

```
Balancer/
├─ app/            # PWA front end (static, RTL Hebrew)
├─ server/         # Local Node.js server, bound to 127.0.0.1 only
├─ scraper/        # Scraper runner using israeli-bank-scrapers
├─ shared/         # Types, category rules, schema
├─ docs/           # Setup guide for Termux, security notes
├─ scripts/        # install / start / backup helpers for Termux
└─ README.md
```

1. **Scraper** (`scraper/`): Node.js using the open-source `israeli-bank-scrapers` library (Puppeteer based). Runs on demand or on a schedule, logs into each configured institution, fetches transactions and balances, and returns normalized data to the server.
2. **Local server** (`server/`): small Node HTTP server. Binds to `127.0.0.1` only (never `0.0.0.0`). Serves the PWA, exposes a local JSON API, owns the encrypted store, and triggers scrapes.
3. **PWA** (`app/`): the RiseUp-like UI. Talks only to the local server on `localhost`.

### Running on Android: feasibility first

Puppeteer needs a real Chromium. On Android this is the biggest risk. **Phase 0 is a feasibility spike** (see Phases). Evaluate, in this order, and document results:

1. Termux + `proot-distro` Debian + Chromium + Node. Set `executablePath` explicitly in Puppeteer, use `--no-sandbox` and headless flags suited to proot.
2. Alternative Chromium/Chrome packaging that works under Termux.
3. If neither works reliably, report back with the exact failure and propose an alternative (for example a native Android WebView-based extractor) **before** building further. Do not silently change the architecture.

Storage: prefer something that installs cleanly on Termux. `better-sqlite3` may fail to compile there. Evaluate Node's built-in `node:sqlite`, `sql.js`, or a simple encrypted JSON store, and choose the most reliable one. Explain the choice.

---

## 2. Security requirements (non-negotiable)

**Credentials**
- Stored only on the device, only encrypted at rest.
- Encryption: AES-256-GCM with a unique random IV per record.
- Key derived from a **master password** using a strong KDF (scrypt or Argon2id) with a per-install random salt and sensible cost parameters.
- The master password is never stored. Without it, credentials cannot be decrypted.
- Decrypt only in memory, only for the duration of a scrape, then discard.
- Optional: app unlock via biometrics/passkey on the PWA side (WebAuthn) as a convenience layer on top of the master password. Do not weaken the core scheme for it.

**Data**
- Transaction database encrypted at rest with a key derived from the same master password (or a separate data key wrapped by it).
- Provide encrypted backup/export and restore, initiated only by the user, to a file he chooses. Never automatic upload.

**Local server**
- Bind `127.0.0.1` only.
- Per-session random token required on every API call. Strict CORS: same origin only.
- Rate-limit the unlock endpoint, with increasing delay on failures.
- Set restrictive security headers and a strict Content-Security-Policy on the PWA.
- No third-party scripts or fonts loaded from CDNs at runtime. Bundle assets locally so the app works offline and leaks nothing.

**Hygiene**
- Never log credentials, tokens, OTP codes, full account numbers or raw HTML of bank pages. Mask account numbers in the UI and logs (last 4 digits).
- Redact secrets from error messages.
- `.gitignore` must exclude databases, backups, `.env`, key files, scraper debug output and screenshots.
- No credentials in the repo, ever. Add a pre-commit check or a simple script that scans for obvious secrets.
- Dependencies: pin versions, keep the list small, document why each one is needed.

**Account safety**
- Many banks lock accounts after repeated failed logins. The scraper must **never retry login automatically after a credential error**. Fail fast, mark the connection as "needs attention", and wait for the user.
- Throttle scrapes: sensible minimum interval between runs per institution, user-initiated by default.
- Handle OTP / two-factor: when an institution requests a one-time code, surface a prompt in the UI, wait for the user to enter it, then continue. Support the library's OTP flow where available. Time out cleanly.

---

## 3. Data model

Normalize everything into a common schema in `shared/`:

- **Institution connection**: id, type (bank / card), provider key, display name, status (ok / needs_attention / otp_required / error), last_sync_at, encrypted credentials blob.
- **Account**: id, connection_id, display name, masked number, type, current balance, currency, last updated.
- **Transaction**: id (stable hash to dedupe across scrapes), account_id, date, processed_date, description, original amount, original currency, charged amount (ILS), type (normal / installments / pending), installment info (number / total), memo, category_id, user_category_override, tags, notes, is_recurring, is_excluded, source identifiers.
- **Category**: id, name (Hebrew), icon, color, parent, type (expense / income / transfer / ignore).
- **Category rule**: pattern (merchant name / regex / contains), category_id, priority, created_by (system / user).
- **Budget**: category_id, month, planned amount, rollover option.
- **Recurring item**: merchant, typical amount, cadence, next expected date, status.
- **Credit card charge schedule**: upcoming card debit date and amount per card, so the "upcoming charges" view works.

Dedupe carefully. Pending transactions can later change date or amount. Handle updates rather than creating duplicates.

---

## 4. Features (RiseUp-style)

Study what RiseUp shows and reproduce the experience, with original visuals and wording (do not copy any proprietary assets, logos or text).

**Core screens**
1. **Home / Dashboard**
   - Current month snapshot: income, expenses, net, remaining budget.
   - Total balance across accounts, with per-account cards.
   - Upcoming credit card charges and the date they hit the bank.
   - Alerts: overspending, unusual charge, connection needs attention.
2. **Monthly view**
   - Month picker with swipe between months.
   - Expenses by category: donut or bar chart plus ranked list with amounts and percent.
   - Budget vs actual per category with progress bars (green / amber / red).
   - Income vs expenses summary.
3. **Transactions**
   - Fast, scrollable list grouped by day. Search, filters (account, category, amount range, date range, uncategorized, recurring).
   - Tap to open a detail sheet: edit category, add note or tag, exclude from budget, split transaction, create a rule from it ("always categorize this merchant as X").
4. **Budget**
   - Set planned amounts per category per month. Copy from previous month. Show fixed vs variable expenses.
5. **Cash flow & trends**
   - Month-over-month comparison, 6 and 12 month trends, average per category, projected end-of-month balance based on recurring items and current pace.
6. **Recurring & installments**
   - Auto-detect subscriptions and standing orders. Show installment payments with remaining count and remaining total.
7. **Accounts & connections**
   - Add, edit, remove an institution. Sync status per connection, manual "Sync now", last sync time. Clear error states in Hebrew.
8. **Settings**
   - Master password change, auto-lock timeout, backup/restore, category management, rules management, demo mode toggle, data wipe.

**Categorization**
- Ship a sensible default Hebrew category set and a starter ruleset for common Israeli merchants.
- Rules engine: user rules beat system rules. When the user recategorizes a transaction, offer to apply to all past and future matches of that merchant.
- Keep the engine deterministic and local. No external AI calls.

**Quality of life**
- Pull-to-refresh triggers a sync.
- Skeleton loaders, smooth transitions, haptic-free but responsive touch targets (min 44px).
- Works fully offline from the local store.
- Export transactions to CSV on demand.

---

## 5. Supported institutions

Use the provider list that `israeli-bank-scrapers` supports at the time of building (check the library for the current list and each provider's required credential fields). Target the user's own institutions first. Design the connection form to render dynamically from each provider's credential fields so adding another institution needs no UI rewrite.

Start with **one bank and one credit card** end to end, then expand.

---

## 6. Demo mode (required)

Build a **Demo Mode** with realistic fake Hebrew data (merchants, salaries, rent, groceries, fuel, subscriptions, installments, a few pending charges, two cards with different billing dates, several months of history). The whole UI must be developed and tested against this, so no real credentials are ever needed during development. A visible banner shows when demo mode is active. Real data and demo data never mix.

---

## 7. Phases

**Phase 0 — Feasibility spike (stop and report)**
- Prove Node + Chromium + Puppeteer run on the phone under Termux (document exact commands in `docs/`).
- Run the scraper library against a harmless target to confirm the browser launches, then confirm the login flow starts for one real provider **without submitting real credentials in this phase** unless the user explicitly runs it himself.
- Choose the storage approach.
- Report findings, risks, and a go / no-go recommendation.

**Phase 1 — Foundations**
- Repo scaffold, README, scripts for Termux install/start, `.gitignore`, secret-scan check.
- Encrypted store, master password setup/unlock, KDF, key handling, local server with token auth and rate limiting.
- Shared schema and migrations.

**Phase 2 — UI shell in Demo Mode**
- PWA shell, RTL Hebrew, theme, navigation, all main screens running on fake data.
- Charts (lightweight, bundled locally), month picker, transaction list and detail sheet.

**Phase 3 — Scraper integration**
- Connection management UI, encrypted credential storage, scrape runner, normalization, dedupe, pending handling, OTP prompt flow, per-connection status and safe error handling.
- One bank + one card working with the user's real data, run by the user.

**Phase 4 — Intelligence**
- Categorization engine and rules UI, budgets, recurring detection, installments, upcoming card charges, projections, alerts.

**Phase 5 — Polish and hardening**
- Backup/restore, auto-lock, CSV export, performance on large histories, accessibility, offline behavior, security review against section 2, final docs.

At the end of each phase: summarize what was built, how to run it on the phone, what was tested, known issues, and what you need from the user.

---

## 8. Working agreements

- Commit small and often with clear messages. Keep `main` runnable.
- Write tests for: encryption round trip, KDF parameters, dedupe logic, categorization rules, normalization of scraper output (using recorded fake fixtures, never real data).
- Keep dependencies minimal. Justify each addition in the README.
- Handle errors in plain Hebrew in the UI and detailed English in dev logs (without secrets).
- If something in this document is impossible or unwise on the target environment, say so and propose an alternative. Do not silently deviate.
- Ask before any action that touches real credentials, real accounts or the network beyond installing dependencies and the scraper's own provider logins.

---

## 9. Risk notes to document in the README

- Automating logins may violate some institutions' terms of service. The app is for the owner's personal use on his own accounts only.
- Provider websites change often. Scrapers can break and need library updates.
- Security depends on the device: strong screen lock, no root, no untrusted apps, device encryption on.
- Loss of the master password means loss of stored credentials. There is no recovery by design.

---

## 10. First task

Start with **Phase 0**. Inspect the reference repo, then write down the exact Termux steps you will take, run what you can, and report back with findings and a go / no-go recommendation before building anything else.
