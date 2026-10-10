#!/data/data/com.termux/files/usr/bin/bash
# Short command for Termux (installed by scripts/install.sh):
#   balancer         start Balancer (or just open it if it is already running)
#   balancer update  get the latest version, install, then start
set -e
DIR="$(cd "$(dirname "$(readlink -f "$0")")/.." && pwd)"
cd "$DIR"
case "${1:-start}" in
  start) exec bash scripts/start.sh ;;
  update) git pull --ff-only && bash scripts/install.sh && exec bash scripts/start.sh ;;
  *) echo "Usage: balancer [update]"; exit 1 ;;
esac
