#!/data/data/com.termux/files/usr/bin/bash
# Installs Balancer's local server in Termux. Safe to re-run.
set -euo pipefail
cd "$(dirname "$0")/.."

if ! command -v node >/dev/null; then
  pkg install -y nodejs
fi
node -e 'const [a,b,c]=process.versions.node.split(".").map(Number); if (a<22||(a===22&&(b<22||(b===22&&c<2)))) { console.error("Node "+process.version+" is too old: need 22.22.2+. Run: pkg upgrade -y"); process.exit(1) }'

# Chromium for the bank scraper (Termux's own build; runs headless in single-process mode)
if ! command -v chromium-browser >/dev/null && ! command -v chromium >/dev/null; then
  pkg install -y x11-repo
  pkg install -y chromium
fi

npm ci --omit=dev --no-audit --no-fund
node scripts/patch-scrapers.mjs
git config core.hooksPath .githooks
mkdir -p data && chmod 700 data

echo
echo "Installed. Start with: bash scripts/start.sh"
