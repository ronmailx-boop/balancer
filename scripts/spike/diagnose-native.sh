#!/data/data/com.termux/files/usr/bin/bash
# Path B: Chromium installed directly in Termux (no Debian/proot).
# Installs packages only; opens a local test page only.
set -uo pipefail
REPO="$(cd "$(dirname "$0")/../.." && pwd)"
OUT="$REPO/phase0-native.txt"
{
  echo "== Termux node: $(node -v 2>/dev/null || echo none)"
  pkg install -y x11-repo
  pkg install -y chromium nodejs
  CHROME="$(command -v chromium-browser || command -v chromium || true)"
  echo "== chromium binary: ${CHROME:-not found}"
  [ -n "$CHROME" ] || { echo "RESULT: no Chromium package in Termux"; exit 1; }
  cd "$REPO/scripts/spike"
  [ -d node_modules/puppeteer-core ] || npm ci --no-audit --no-fund
  CHROME_PATH="$CHROME" node diagnose-browser.mjs
} 2>&1 | tee "$OUT"
echo
echo "Saved to $OUT"
