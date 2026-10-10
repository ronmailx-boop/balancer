# Balancer

Personal, local-only finance app for Android (Termux). It pulls transactions from the owner's Israeli bank and credit card accounts with [`israeli-bank-scrapers`](https://github.com/eshaham/israeli-bank-scrapers) and shows them in a RiseUp-style Hebrew RTL PWA. No cloud: all data and credentials stay encrypted on the phone.

- Full spec: [`docs/MASTER_PROMPT.md`](docs/MASTER_PROMPT.md)
- Current status: [`PROJECT_STATE.md`](PROJECT_STATE.md)
- Security design: [`docs/security.md`](docs/security.md), review: [`docs/security-review.md`](docs/security-review.md)
- Phase 0 feasibility report: [`docs/phase0-feasibility.md`](docs/phase0-feasibility.md)

## Run on the phone (Termux)

First time:

```bash
cd ~/balancer && bash scripts/install.sh
```

After that:

```bash
balancer          # starts the server and opens Chrome at http://127.0.0.1:8765 (or just opens it if already running)
balancer update   # git pull + install + start
```

Home-screen icon: install the **Termux:Widget** app (from the same store as Termux), add its widget, and pick **Balancer**.

Stop with Ctrl+C in Termux; the vault locks on exit.

**Backups:** Settings → גיבוי ושחזור → "הורדת גיבוי מוצפן". Keep the file off the phone (Drive, email to yourself). On a new phone: install, open the app, and choose "יש לי קובץ גיבוי" on the first screen. The backup opens only with the master password that was in use when it was made.

**Forgot the master password:** there is no recovery. `rm -rf ~/balancer/data` and start over (or restore a backup whose password you know).

## Layout

```
app/       PWA front end (static, RTL Hebrew), served by the local server
server/    Local Node server: encrypted vault, API, security headers
shared/    Schema and migrations, default categories and rules, rules engine, demo data generator
scraper/   Scraper worker (separate process), Chromium settings, provider list
scripts/   install / start / balancer command / secret-scan / scraper patch; scripts/spike = Phase 0 checks
tests/     node:test suites (fake data only)
docs/      Spec, security notes, reports
```

## Development

```bash
npm install
npm test               # crypto, KDF, vault, migrations, server security, backup/restore, demo data, queries, budget cycle,
                       # normalization, dedupe, sync, recurring detection, splits, rules, performance (25k transactions)
npm run secret-scan    # scan all tracked files
```

## Dependencies

| Package | Where | Why |
|---|---|---|
| `sql.js` 1.14.2 | server | SQLite as WASM: real SQL with no native build (works on Termux), and the DB can be encrypted as one blob |
| `israeli-bank-scrapers-core` 6.12.2 | scraper | The bank and card scrapers, on `puppeteer-core` so we supply our own Chromium (Termux's `chromium-browser`) |
| `puppeteer-core` 24.43.1 | scraper | Launches Chromium with a per-connection profile (same version the library uses) |

`npm audit` reports an FTP-parser issue (`basic-ftp`) deep inside puppeteer's browser-download tooling. Balancer never downloads browsers and never uses FTP, so that code path is not reachable.

Everything else uses Node built-ins (`node:http`, `node:crypto`, `node:test`).

## Risks

- Automating logins may violate some institutions' terms of service. This app is for the owner's personal use on his own accounts only.
- Bank and card websites change often. Scrapers can break and need library updates.
- Security depends on the device: strong screen lock, no root, no untrusted apps, device encryption on.
- Losing the master password means losing the stored data and credentials. There is no recovery, by design.
