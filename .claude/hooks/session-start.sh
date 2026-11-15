#!/bin/bash
# Claude Code cloud sessions start from a fresh clone. Install dependencies
# (which also links package-shipped agent skills) and sync the reference
# sources in repos/ (which also links Foldkit's skills).
set -euo pipefail

if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

cd "${CLAUDE_PROJECT_DIR:-.}"

# pnpm comes from Corepack, at the version in package.json's packageManager.
# pnpm 12 is a native executable that older Corepack releases (such as the one
# bundled with Node 24.11) cannot install, so update Corepack when needed.
export COREPACK_ENABLE_DOWNLOAD_PROMPT=0
pnpm_version="$(node -p "require('./package.json').packageManager.split('@')[1]")"
if ! pnpm --version 2>/dev/null | grep -qxF "$pnpm_version"; then
  npm install -g corepack@latest
  corepack enable
fi

# Dependencies: reinstall only when a manifest, the lockfile or this script changed.
hashes=node_modules/.session-start.sha256
if ! sha256sum --check --status "$hashes" 2>/dev/null; then
  rm -f "$hashes"
  pnpm install
  sha256sum .claude/hooks/session-start.sh package.json pnpm-lock.yaml pnpm-workspace.yaml \
    packages/*/package.json docs/package.json > "$hashes" || rm -f "$hashes"
fi

# Reference sources: re-sync only when the catalog or the sync script changed.
repo_hashes=repos/.session-start.sha256
if ! sha256sum --check --status "$repo_hashes" 2>/dev/null; then
  rm -f "$repo_hashes"
  bash scripts/sync-repos.sh
  sha256sum .claude/hooks/session-start.sh pnpm-workspace.yaml scripts/sync-repos.sh > "$repo_hashes" \
    || rm -f "$repo_hashes"
fi
