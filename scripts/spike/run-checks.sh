#!/data/data/com.termux/files/usr/bin/bash
# Runs the Phase 0 checks inside Debian. Opens login pages only; never types anything.
REPO="$(cd "$(dirname "$0")/../.." && pwd)"
termux-wake-lock 2>/dev/null || true
proot-distro login debian --bind "$REPO:/balancer" -- bash -c '
  cd /balancer/scripts/spike
  echo "===== env";      node check-env.mjs
  echo "===== browser";  node launch-browser.mjs
  for p in leumi visaCal max; do echo "===== probe $p"; node login-page-probe.mjs $p; done
' 2>&1 | tee "$REPO/phase0-results.txt"
termux-wake-unlock 2>/dev/null || true
echo
echo "Saved to $REPO/phase0-results.txt"
