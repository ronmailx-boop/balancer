#!/data/data/com.termux/files/usr/bin/bash
# Short command for Termux (installed by scripts/install.sh):
#   balancer          start Balancer (or just open it if it is already running)
#   balancer update   get the latest version, install, then restart
#   balancer stop     stop the server (the vault locks)
set -e
DIR="$(cd "$(dirname "$(readlink -f "$0")")/.." && pwd)"
cd "$DIR"

stop_server() {
  local pids
  pids="$(pgrep -f '^node server/index.js' || true)"
  [ -z "$pids" ] && return 0
  kill $pids 2>/dev/null || true
  for _ in $(seq 1 25); do pgrep -f '^node server/index.js' >/dev/null || return 0; sleep 0.2; done
}

case "${1:-start}" in
  start) exec bash scripts/start.sh ;;
  update) git pull --ff-only && bash scripts/install.sh && stop_server && exec bash scripts/start.sh ;;
  stop) stop_server && echo "Balancer stopped." ;;
  *) echo "Usage: balancer [update|stop]"; exit 1 ;;
esac
