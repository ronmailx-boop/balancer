#!/data/data/com.termux/files/usr/bin/bash
# Starts the local server and opens Balancer in the phone's default browser (Chrome).
# Stop with Ctrl+C (the vault locks on exit).
cd "$(dirname "$0")/.."
PORT="${BALANCER_PORT:-8765}"
URL="http://127.0.0.1:$PORT/"

[ -d node_modules/sql.js ] || bash scripts/install.sh

termux-wake-lock 2>/dev/null || true
trap 'termux-wake-unlock 2>/dev/null || true' EXIT

# Open the browser once the server answers
(
  for _ in $(seq 1 50); do
    if curl -fsS -o /dev/null "${URL}api/status" 2>/dev/null; then
      termux-open-url "$URL" 2>/dev/null || echo "Open $URL in Chrome"
      exit 0
    fi
    sleep 0.2
  done
  echo "The server did not start; see the messages above."
) &

node server/index.js
