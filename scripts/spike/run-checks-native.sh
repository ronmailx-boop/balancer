#!/data/data/com.termux/files/usr/bin/bash
# Path B full check: Termux-native Chromium in single-process mode.
# Opens public pages only (example.com and the bank/card login pages); never types anything.
REPO="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$REPO/scripts/spike"
export CHROME_PATH="$(command -v chromium-browser || command -v chromium)"
termux-wake-lock 2>/dev/null || true
{
  echo "===== browser";  node launch-browser.mjs
  for p in leumi visaCal max; do echo "===== probe $p"; node login-page-probe.mjs $p; done
} 2>&1 | grep --line-buffered -v "CANNOT LINK\|needed or dlopened\|accessible for the namespace" | tee "$REPO/phase0-native-checks.txt"
termux-wake-unlock 2>/dev/null || true
echo
echo "Saved to $REPO/phase0-native-checks.txt"
