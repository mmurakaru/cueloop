#!/bin/sh
# upgrade: install the previous version, then the target, on a fresh VM. The
# binary is replaced, reports the target version, and leaves nothing else in the
# install dir. The controller sets CUELOOP_MATRIX_PREVIOUS_VERSION and
# CUELOOP_VERSION.
set -u
. "$(dirname "$0")/lib.sh"

: "${CUELOOP_MATRIX_PREVIOUS_VERSION:?upgrade needs CUELOOP_MATRIX_PREVIOUS_VERSION}"
: "${CUELOOP_VERSION:?upgrade needs CUELOOP_VERSION}"

expect upgrade-prev upgrade-exit upgrade-replaced upgrade-version upgrade-clean-dir

scenario_reset "$MATRIX_SANDBOX/upgrade-home" "$MATRIX_SANDBOX/upgrade-bin"

binary="$MATRIX_INSTALL_DIR/cueloop"
run_installer "$CUELOOP_MATRIX_PREVIOUS_VERSION" "$MATRIX_SANDBOX/upgrade-prev.log"
check upgrade-prev "previous version did not install" test -x "$binary"
before="$(sha256_of "$binary")"

run_installer "$CUELOOP_VERSION" "$MATRIX_SANDBOX/upgrade-target.log"
status=$?
after="$(sha256_of "$binary")"

check upgrade-exit "upgrade exited $status" test "$status" -eq 0
check upgrade-replaced "binary hash unchanged after upgrade" test "$before" != "$after"
assert_version_reports upgrade-version "${CUELOOP_VERSION#cueloop@}"
assert_clean_install_dir upgrade-clean-dir
