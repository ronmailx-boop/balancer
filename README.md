# Balancer

Personal, local-only finance app for Android (Termux). It pulls transactions from the owner's Israeli bank and credit card accounts with [`israeli-bank-scrapers`](https://github.com/eshaham/israeli-bank-scrapers) and shows them in a RiseUp-style Hebrew RTL PWA. No cloud: all data and credentials stay encrypted on the phone.

- Full spec: [`docs/MASTER_PROMPT.md`](docs/MASTER_PROMPT.md)
- Current status: [`PROJECT_STATE.md`](PROJECT_STATE.md)
- Phase 0 feasibility report: [`docs/phase0-feasibility.md`](docs/phase0-feasibility.md)

## Phase 0 checks on the phone

```bash
bash scripts/spike/termux-setup.sh
proot-distro login debian --bind "$PWD:/balancer" -- bash -c 'cd /balancer/scripts/spike && npm run env && npm run browser && npm run probe -- max'
```

The probe only opens a public login page. It never enters or submits credentials.

## Dependencies (spike)

| Package | Why |
|---|---|
| `israeli-bank-scrapers-core` | The scrapers, built on `puppeteer-core` so we supply our own Chromium |
| `puppeteer-core` | Drives Chromium for the launch test (same version the library uses) |
| `sql.js` | SQLite compiled to WASM: no native build on Termux, the DB can be encrypted as one blob |
