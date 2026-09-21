#!/usr/bin/env bash
# Installs the artifacts-sync and explainers-sync launchd jobs.
set -euo pipefail

LOG_DIR="$HOME/Library/Logs/seyonv-site"
AGENTS_DIR="$HOME/Library/LaunchAgents"
SITE_PLIST="$HOME/Desktop/repos/seyonv.github.io/launchd/com.seyonv.artifacts-sync.plist"
EXPLAINERS_PLIST="$HOME/Desktop/repos/explainers/launchd/com.seyonv.explainers-sync.plist"

mkdir -p "$LOG_DIR"
mkdir -p "$AGENTS_DIR"

install_plist() {
  local src="$1"
  local label
  label=$(basename "$src" .plist)
  local dest="$AGENTS_DIR/$(basename "$src")"

  cp "$src" "$dest"

  launchctl bootout "gui/$UID/$label" 2>/dev/null || true
  launchctl bootstrap "gui/$UID" "$dest"

  echo "--- $label ---"
  launchctl print "gui/$UID/$label" | grep -E "state|last exit"
}

install_plist "$SITE_PLIST"
install_plist "$EXPLAINERS_PLIST"
