# Balancer

Personal, local-only finance app for Android (Termux). It pulls transactions from the owner's Israeli bank and credit card accounts with [`israeli-bank-scrapers`](https://github.com/eshaham/israeli-bank-scrapers) and shows them in a RiseUp-style Hebrew RTL PWA. No cloud: all data and credentials stay encrypted on the phone.

- Full spec: [`docs/MASTER_PROMPT.md`](docs/MASTER_PROMPT.md)
- Current status: [`PROJECT_STATE.md`](PROJECT_STATE.md)
- Security design: [`docs/security.md`](docs/security.md)
- Phase 0 feasibility report: [`docs/phase0-feasibility.md`](docs/phase0-feasibility.md)

## Run on the phone (Termux)

```bash
cd ~/balancer && git pull
bash scripts/install.sh     # once
bash scripts/start.sh       # starts the server and opens Chrome at http://127.0.0.1:8765
```

Stop with Ctrl+C in Termux; the vault locks on exit.

## Layout

```
app/       PWA front end (static, RTL Hebrew), served by the local server
server/    Local Node server: encrypted vault, API, security headers
shared/    Schema and migrations, default categories and rules, rules engine, demo data generator
scraper/   (Phase 3) scraper runner
scripts/   install / start / secret-scan; scripts/spike = Phase 0 checks
tests/     node:test suites (fake data only)
docs/      Spec, security notes, reports
```

## Development

```bash
npm install
npm test               # 46 tests: crypto, KDF, vault, migrations, server security, log redaction, demo data, queries
npm run secret-scan    # scan all tracked files
```

## Dependencies

| Package | Where | Why |
|---|---|---|
| `sql.js` 1.14.2 | server | SQLite as WASM: real SQL with no native build (works on Termux), and the DB can be encrypted as one blob |
| `israeli-bank-scrapers-core` 6.12.2 | scripts/spike (Phase 3: scraper) | The bank and card scrapers, on `puppeteer-core` so we supply our own Chromium |
| `puppeteer-core` 24.43.1 | scripts/spike | Browser launch checks (same version the library uses) |

Everything else uses Node built-ins (`node:http`, `node:crypto`, `node:test`).

## Risks

- Automating logins may violate some institutions' terms of service. This app is for the owner's personal use on his own accounts only.
- Bank and card websites change often. Scrapers can break and need library updates.
- Security depends on the device: strong screen lock, no root, no untrusted apps, device encryption on.
- Losing the master password means losing the stored data and credentials. There is no recovery, by design.
