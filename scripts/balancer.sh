#!/data/data/com.termux/files/usr/bin/bash
# Short command for Termux (installed by scripts/install.sh):
#   balancer          start Balancer in this session (or just open it if it is already running)
#   balancer bg       start it in the background (this is what opening Termux does)
#   balancer update   get the latest version, install, then restart in the background
#   balancer stop     stop the server (the vault locks)
#   balancer log      show the server messages
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

# Runs the server in the background, so the Termux session stays free for commands
start_bg() {
  if curl -fsS -o /dev/null http://127.0.0.1:8765/api/status 2>/dev/null; then
    echo "Balancer is already running."
    return 0
  fi
  mkdir -p data
  nohup bash scripts/start.sh > data/server.log 2>&1 &
  echo "Balancer is running in the background. Update: balancer update | Stop: balancer stop | Log: balancer log"
}

case "${1:-start}" in
  start) exec bash scripts/start.sh ;;
  bg) start_bg ;;
  update) git pull --ff-only && bash scripts/install.sh && stop_server && start_bg ;;
  stop) stop_server && echo "Balancer stopped." ;;
  log) exec tail -n 50 -f data/server.log ;;
  *) echo "Usage: balancer [bg|update|stop|log]"; exit 1 ;;
esac
