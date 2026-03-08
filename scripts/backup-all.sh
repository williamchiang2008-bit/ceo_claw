#!/usr/bin/env bash
set -euo pipefail

REPOS=(
  "/Users/ceo_claw/.openclaw/workspace"
  "/Users/ceo_claw/Projects/schedule-app"
)

log() { printf '[backup] %s\n' "$*"; }

for repo in "${REPOS[@]}"; do
  if [[ ! -d "$repo/.git" ]]; then
    log "skip (not git repo): $repo"
    continue
  fi

  log "repo: $repo"
  cd "$repo"

  branch="$(git rev-parse --abbrev-ref HEAD)"
  if [[ -n "$(git status --porcelain)" ]]; then
    log "working tree not clean, skip push: $repo"
    continue
  fi

  log "fetch origin"
  git fetch origin "$branch" >/dev/null 2>&1 || true

  log "push origin/$branch"
  git push origin "$branch"
  log "done: $repo"
  echo

done

log "all done"
