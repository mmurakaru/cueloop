#!/bin/sh
set -u
. "$(dirname "$0")/../lib.sh"

: "${MATRIX_REPO_ROOT:?plugin needs MATRIX_REPO_ROOT}"

expect plugin-manifest-exists plugin-name plugin-version codex-version pi-version

manifest="$MATRIX_REPO_ROOT/.claude-plugin/plugin.json"
pkg="$MATRIX_REPO_ROOT/packages/cli/package.json"
codex_manifest="$MATRIX_REPO_ROOT/plugin.json"
pi_manifest="$MATRIX_REPO_ROOT/packages/pi/package.json"

field() { grep -o "\"$2\"[[:space:]]*:[[:space:]]*\"[^\"]*\"" "$1" | head -n 1 | sed -e 's/.*:[[:space:]]*"//' -e 's/"$//'; }

check plugin-manifest-exists "no plugin.json" test -f "$manifest"
if [ "$(field "$manifest" name)" = "cueloop" ]; then ok plugin-name; else bad plugin-name "plugin name is not cueloop"; fi
manifest_version="$(field "$manifest" version)"
pkg_version="$(field "$pkg" version)"
if [ -n "$manifest_version" ] && [ "$manifest_version" = "$pkg_version" ]; then
  ok plugin-version
else
  bad plugin-version "plugin $manifest_version != cli $pkg_version"
fi
if [ "$(field "$codex_manifest" version)" = "$pkg_version" ]; then
  ok codex-version
else
  bad codex-version "Codex plugin version differs from CLI"
fi
if [ "$(field "$pi_manifest" version)" = "$pkg_version" ]; then
  ok pi-version
else
  bad pi-version "pi extension version differs from CLI"
fi
