#!/data/data/com.termux/files/usr/bin/bash
# Installs Balancer's local server in Termux. Safe to re-run.
set -euo pipefail
cd "$(dirname "$0")/.."

if ! command -v node >/dev/null; then
  pkg install -y nodejs
fi
node -e 'const [a,b]=process.versions.node.split(".").map(Number); if (a<22||(a===22&&b<12)) { console.error("Node "+process.version+" is too old: need 22.12+. Run: pkg upgrade -y"); process.exit(1) }'

npm ci --omit=dev --no-audit --no-fund
git config core.hooksPath .githooks
mkdir -p data && chmod 700 data

echo
echo "Installed. Start with: bash scripts/start.sh"
