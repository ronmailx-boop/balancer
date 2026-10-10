#!/data/data/com.termux/files/usr/bin/bash
# Phase 0 setup on Android/Termux (path A: proot-distro Debian + Chromium + Node).
# Run inside the Termux app (installed from F-Droid or GitHub, not Google Play).
# Re-running is safe. It installs packages only; no credentials are involved.
set -euo pipefail

echo "== 1/4 Termux packages"
pkg update -y
pkg install -y proot-distro git

echo "== 2/4 Debian userland"
if ! proot-distro list 2>/dev/null | grep -q "debian.*installed"; then
  proot-distro install debian || true   # 'already installed' is fine
fi

echo "== 3/4 Chromium + Node 22 inside Debian"
proot-distro login debian -- bash -c '
  set -e
  apt-get update
  apt-get install -y chromium ca-certificates curl fonts-noto-core
  if ! command -v node >/dev/null || ! node -e "process.exit(+process.versions.node.split(\".\")[0] < 22)"; then
    curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
    apt-get install -y nodejs
  fi
  echo "node: $(node -v)"
  echo "chromium: $(chromium --version)"
'

echo "== 4/4 Spike dependencies"
# The repo is shared into Debian at the same path via --bind below.
REPO="$(cd "$(dirname "$0")/../.." && pwd)"
proot-distro login debian --bind "$REPO:/balancer" -- bash -c '
  cd /balancer/scripts/spike && npm ci --no-audit --no-fund
'

cat <<MSG

Setup done. Run the checks:
  proot-distro login debian --bind "$REPO:/balancer" -- bash -c 'cd /balancer/scripts/spike && npm run env && npm run browser && npm run probe -- max'
MSG
