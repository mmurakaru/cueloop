#!/bin/sh
# plugin: the Claude Code plugin manifest is valid JSON, names cueloop, and its
# version matches the CLI package. A pure repository check, no install.
set -u
. "$(dirname "$0")/../lib.sh"

: "${MATRIX_REPO_ROOT:?plugin needs MATRIX_REPO_ROOT}"

expect plugin-manifest-exists plugin-name plugin-version

manifest="$MATRIX_REPO_ROOT/.claude-plugin/plugin.json"
pkg="$MATRIX_REPO_ROOT/packages/cli/package.json"

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
