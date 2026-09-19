#!/bin/sh
# npm: `npm install -g cueloop@<version>` installs the published CLI globally
# and it runs. The package ships the TypeScript entry and needs Bun at runtime,
# the documented requirement, so Bun stays on PATH. This exercises the real
# published npm artifact, so it belongs to the release-verification run, not a
# pre-publish gate where the package is not on the registry yet.
set -u
. "$(dirname "$0")/../lib.sh"

expect npm-install npm-version

version="${CUELOOP_VERSION:-latest}"
prefix="$MATRIX_SANDBOX/npm-prefix"
rm -rf "$prefix"
mkdir -p "$prefix"

if npm install -g --prefix "$prefix" "cueloop@${version}" >"$MATRIX_SANDBOX/npm-install.log" 2>&1; then
  ok npm-install
else
  bad npm-install "npm install -g cueloop@${version} failed"
fi

# the global bin: unix under prefix/bin, Windows under prefix directly
launcher="$prefix/bin/cueloop"
[ -f "$launcher" ] || launcher="$prefix/cueloop"
if "$launcher" --version >/dev/null 2>&1 || "${launcher}.cmd" --version >/dev/null 2>&1; then
  ok npm-version
else
  bad npm-version "installed cueloop did not run --version"
fi
