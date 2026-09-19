#!/bin/sh
# brew: the Homebrew formula installs the release binary and passes its own
# test block. The host rewrites Formula/cueloop.rb to the release under test
# with scripts/update-formula.ts (FORMULA_CHECKSUMS points at the release's
# checksums.txt), so this exercises the exact formula the tap will ship.
set -u
. "$(dirname "$0")/../lib.sh"

: "${MATRIX_REPO_ROOT:?brew needs MATRIX_REPO_ROOT}"

expect brew-available brew-install brew-version brew-test

formula="$MATRIX_REPO_ROOT/Formula/cueloop.rb"

if command -v brew >/dev/null 2>&1; then
  ok brew-available
else
  # a fail here plus the finalizer's synthetic fails for the rest mark the
  # scenario broken: brew is a prerequisite everywhere this scenario runs
  bad brew-available "brew is not on PATH"
  exit 1
fi

if brew install --formula "$formula" >"$MATRIX_SANDBOX/brew-install.log" 2>&1; then
  ok brew-install
else
  bad brew-install "brew install --formula failed"
fi
check brew-version "installed cueloop did not run" cueloop --version
if brew test cueloop >"$MATRIX_SANDBOX/brew-test.log" 2>&1; then
  ok brew-test
else
  bad brew-test "brew test cueloop failed"
fi
brew uninstall cueloop >/dev/null 2>&1 || true
