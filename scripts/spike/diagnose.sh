#!/data/data/com.termux/files/usr/bin/bash
# Runs the browser diagnostics inside Debian and saves a short report.
REPO="$(cd "$(dirname "$0")/../.." && pwd)"
echo "Termux node: $(node -v 2>/dev/null || echo none)"
proot-distro login debian --bind "$REPO:/balancer" -- bash -c '
  cd /balancer/scripts/spike
  [ -d node_modules ] || npm ci --no-audit --no-fund
  node diagnose-browser.mjs
' 2>&1 | tee "$REPO/phase0-diagnose.txt"
echo
echo "Saved to $REPO/phase0-diagnose.txt"
