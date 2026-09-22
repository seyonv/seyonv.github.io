#!/usr/bin/env bash
# Sync artifacts from transcripts, refresh thumbnails, seal, commit and push.
set -euo pipefail
cd "$(dirname "$0")"

branch=$(git rev-parse --abbrev-ref HEAD)
if [ "$branch" != "main" ]; then
  echo "Refusing to publish from branch '$branch' (GitHub Pages serves main)."
  exit 1
fi

lock="$(git rev-parse --git-dir)/publish.lock"
if [ -e "$lock" ] && find "$lock" -maxdepth 0 -mmin +60 | grep -q .; then
  echo "Removing stale publish lock."
  rmdir "$lock"
fi
if ! mkdir "$lock" 2>/dev/null; then
  echo "Another publish is running."
  exit 0
fi
trap 'rmdir "$lock"' EXIT

node scripts/sync-artifacts.mjs
node scripts/thumbs.mjs || echo "thumbs: failed, keeping previous thumbnails"
node scripts/seal.mjs
git add -A artifacts

committed=0
if ! git diff --cached --quiet; then
  git commit -q -m "Update artifacts"
  committed=1
fi

pushed=0
if [ "$(git rev-list --count @{u}..HEAD)" -gt 0 ]; then
  git push -q
  pushed=1
fi

if [ "$committed" -eq 0 ] && [ "$pushed" -eq 0 ]; then
  echo "Nothing new to publish."
  exit 0
fi

echo "Pushed. Live in about a minute at https://seyonv.github.io/artifacts/"
