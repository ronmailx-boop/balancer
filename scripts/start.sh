#!/data/data/com.termux/files/usr/bin/bash
# Starts the local server and opens Balancer in the phone's default browser (Chrome).
# Stop with Ctrl+C (the vault locks on exit).
cd "$(dirname "$0")/.."
PORT="${BALANCER_PORT:-8765}"
URL="http://127.0.0.1:$PORT/"

[ -d node_modules/sql.js ] || bash scripts/install.sh

# Already running (e.g. in another Termux session): just open it
if curl -fsS -o /dev/null "${URL}api/status" 2>/dev/null; then
  [ -n "${BALANCER_NO_BROWSER:-}" ] || termux-open-url "$URL" 2>/dev/null || echo "Balancer is already running: open $URL in Chrome"
  exit 0
fi

termux-wake-lock 2>/dev/null || true
trap 'termux-wake-unlock 2>/dev/null || true' EXIT

# Open the browser once the server answers
(
  for _ in $(seq 1 50); do
    if curl -fsS -o /dev/null "${URL}api/status" 2>/dev/null; then
      [ -n "${BALANCER_NO_BROWSER:-}" ] || termux-open-url "$URL" 2>/dev/null || echo "Open $URL in Chrome"
      exit 0
    fi
    sleep 0.2
  done
  echo "The server did not start; see the messages above."
) &

# Loads optional settings from .env (see .env.example)
[ -f .env ] && set -a && . ./.env && set +a
node server/index.js
