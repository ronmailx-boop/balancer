#!/data/data/com.termux/files/usr/bin/bash
# Phase 0 setup on Android/Termux (path A: proot-distro Debian + Chromium + Node).
# Re-running is safe. It installs packages only; no credentials are involved.
set -euo pipefail

REPO="$(cd "$(dirname "$0")/../.." && pwd)"
DEBIAN_ROOT="$PREFIX/var/lib/proot-distro/installed-rootfs/debian"

echo "== 1/4 Termux packages"
# Full upgrade first: a partial upgrade breaks shared libs (e.g. curl vs libngtcp2).
pkg upgrade -y -o Dpkg::Options::=--force-confnew
pkg install -y -o Dpkg::Options::=--force-confnew proot-distro git

echo "== 2/4 Debian userland"
if [ ! -d "$DEBIAN_ROOT" ]; then
  proot-distro install debian
fi

echo "== 3/4 Chromium + Node 22 inside Debian"
proot-distro login debian -- bash -c '
  set -e
  export DEBIAN_FRONTEND=noninteractive
  apt-get update
  apt-get install -y chromium ca-certificates curl fonts-noto-core
  if ! command -v node >/dev/null || ! node -e "const [a,b,c]=process.versions.node.split(\".\").map(Number);process.exit(a>22||(a==22&&(b>22||(b==22&&c>=2)))?0:1)"; then
    curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
    apt-get install -y nodejs
  fi
  echo "node: $(node -v)"
  echo "chromium: $(chromium --version)"
'

echo "== 4/4 Spike dependencies"
proot-distro login debian --bind "$REPO:/balancer" -- bash -c '
  cd /balancer/scripts/spike && npm ci --no-audit --no-fund
'
echo "Setup done."
