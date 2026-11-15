#!/usr/bin/env bash
# Clone the source of our core dependencies into repos/, each checked out at
# the tag matching the version pinned in pnpm-workspace.yaml's catalog.
# Coding agents read these sources instead of guessing APIs.
#
#   repos/alchemy  alchemy-run/alchemy  @ v<alchemy>
#   repos/effect   Effect-TS/effect     @ effect@<effect>
#   repos/foldkit  foldkit/foldkit      @ foldkit@<foldkit>
#
# Idempotent: a repo already at the right tag is left alone. Shallow clones
# keep it fast; repos/ is gitignored.
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$root"

# Read a version from the catalog in pnpm-workspace.yaml.
catalog_version() {
  local name="$1"
  awk -v key="$name" '
    /^catalog:/ { in_catalog = 1; next }
    in_catalog && /^[^[:space:]#]/ { in_catalog = 0 }
    in_catalog {
      line = $0
      sub(/#.*/, "", line)
      split(line, kv, ":")
      k = kv[1]; gsub(/[[:space:]"]/, "", k)
      if (k == key) { v = kv[2]; gsub(/[[:space:]"]/, "", v); print v; exit }
    }
  ' pnpm-workspace.yaml
}

sync_repo() {
  local dir="$1" url="$2" tag="$3"
  local target="repos/$dir"
  # Several tags can point at one commit (Effect tags every package), so check
  # that ours is among them rather than asking for "the" tag.
  if [ -d "$target/.git" ] && git -C "$target" tag --points-at HEAD 2>/dev/null | grep -qxF "$tag"; then
    echo "repos/$dir: already at $tag"
    return
  fi
  echo "repos/$dir: cloning $url at $tag"
  rm -rf "$target"
  git clone --quiet --depth 1 --branch "$tag" --single-branch "$url" "$target" \
    -c advice.detachedHead=false
}

mkdir -p repos
sync_repo alchemy https://github.com/alchemy-run/alchemy.git "v$(catalog_version alchemy)"
sync_repo effect https://github.com/Effect-TS/effect.git "effect@$(catalog_version effect)"
sync_repo foldkit https://github.com/foldkit/foldkit.git "foldkit@$(catalog_version foldkit)"

# Foldkit ships its app-building skills in the repository, not in the npm
# package, and they expect the source at repos/foldkit. Link them next to the
# skills pnpm links from node_modules. The links are gitignored.
mkdir -p .claude/skills
for skill in foldkit generate-program audit-program; do
  ln -sfn "../../repos/foldkit/skills/$skill" ".claude/skills/$skill"
done
