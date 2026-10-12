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

# Shortcuts (Termux only): the `balancer` command, and a home-screen icon via the Termux:Widget app
if [ -n "${PREFIX:-}" ] && [ -d "$PREFIX/bin" ] && [[ "$PREFIX" == *com.termux* ]]; then
  chmod +x scripts/balancer.sh scripts/start.sh
  ln -sf "$PWD/scripts/balancer.sh" "$PREFIX/bin/balancer"
  mkdir -p "$HOME/.shortcuts"
  printf '#!/data/data/com.termux/files/usr/bin/bash\nexec bash %s/scripts/start.sh\n' "$PWD" > "$HOME/.shortcuts/Balancer"
  chmod 700 "$HOME/.shortcuts/Balancer"

  # Start with the phone: the Termux:Boot app runs this after a reboot (in the background, no browser)
  mkdir -p "$HOME/.termux/boot"
  printf '#!/data/data/com.termux/files/usr/bin/sh\ntermux-wake-lock\nBALANCER_NO_BROWSER=1 exec bash %s/scripts/start.sh > %s/data/server.log 2>&1\n' "$PWD" "$PWD" > "$HOME/.termux/boot/balancer"
  chmod 700 "$HOME/.termux/boot/balancer"

  # Opening Termux starts Balancer if it is not already running (a block between markers in ~/.bashrc)
  touch "$HOME/.bashrc"
  sed -i '/# >>> balancer autostart >>>/,/# <<< balancer autostart <<</d' "$HOME/.bashrc"
  cat >> "$HOME/.bashrc" <<'RC'
# >>> balancer autostart >>>
if [ -z "${BALANCER_NO_AUTOSTART:-}" ] && command -v balancer >/dev/null \
   && ! curl -fsS -o /dev/null http://127.0.0.1:8765/api/status 2>/dev/null; then
  balancer bg
fi
# <<< balancer autostart <<<
RC
fi

echo
echo "Installed. Start with: balancer   (update with: balancer update)"
