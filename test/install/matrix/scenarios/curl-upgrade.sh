#!/bin/sh
# curl-upgrade: install the previous version, then the target version, and
# prove the binary was replaced with nothing left behind in the install dir.
# The host sets CUELOOP_MATRIX_PREVIOUS_VERSION and CUELOOP_VERSION.
set -u
. "$(dirname "$0")/../lib.sh"

: "${CUELOOP_MATRIX_PREVIOUS_VERSION:?curl-upgrade needs CUELOOP_MATRIX_PREVIOUS_VERSION}"
: "${CUELOOP_VERSION:?curl-upgrade needs CUELOOP_VERSION}"

expect curl-upgrade-prev curl-upgrade-exit curl-upgrade-replaced \
  curl-upgrade-version curl-upgrade-clean-dir

scenario_reset "$MATRIX_SANDBOX/upgrade-home" "$MATRIX_SANDBOX/upgrade-bin"

binary="$MATRIX_INSTALL_DIR/cueloop"
run_installer "$CUELOOP_MATRIX_PREVIOUS_VERSION" "$MATRIX_SANDBOX/upgrade-prev.log"
check curl-upgrade-prev "previous version did not install" test -x "$binary"
before="$(sha256_of "$binary")"

run_installer "$CUELOOP_VERSION" "$MATRIX_SANDBOX/upgrade-target.log"
status=$?
after="$(sha256_of "$binary")"

check curl-upgrade-exit "upgrade exited $status" test "$status" -eq 0
check curl-upgrade-replaced "binary hash unchanged after upgrade" test "$before" != "$after"
target="${CUELOOP_VERSION#cueloop@}"
if "$binary" --version 2>/dev/null | grep -q "$target"; then ok curl-upgrade-version; else bad curl-upgrade-version "--version does not report $target"; fi

# the install dir must hold only the binary: no partial download left behind
leftover="$(ls -A "$MATRIX_INSTALL_DIR" | grep -v '^cueloop$' || true)"
if [ -z "$leftover" ]; then ok curl-upgrade-clean-dir; else bad curl-upgrade-clean-dir "stray files in install dir: $leftover"; fi
