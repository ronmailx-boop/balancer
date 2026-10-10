#!/data/data/com.termux/files/usr/bin/bash
# One command for a fresh Termux:
#   curl -fsSL https://raw.githubusercontent.com/ronmailx-boop/balancer/claude/new-session-dwvvzt/scripts/spike/bootstrap.sh -o b.sh && bash b.sh
set -euo pipefail
BRANCH=claude/new-session-dwvvzt
command -v git >/dev/null || pkg install -y git
if [ -d "$HOME/balancer/.git" ]; then
  git -C "$HOME/balancer" fetch origin "$BRANCH"
  git -C "$HOME/balancer" checkout -B "$BRANCH" "origin/$BRANCH"
else
  git clone -b "$BRANCH" https://github.com/ronmailx-boop/balancer "$HOME/balancer"
fi
bash "$HOME/balancer/scripts/spike/termux-setup.sh"
bash "$HOME/balancer/scripts/spike/run-checks.sh"
