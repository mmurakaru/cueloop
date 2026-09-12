#!/bin/sh
# curl-rerun: a second install of the same version reports "already installed"
# and downloads nothing.
set -u
. "$(dirname "$0")/../lib.sh"

expect curl-rerun-first curl-rerun-second-exit curl-rerun-already curl-rerun-no-download

scenario_reset "$MATRIX_SANDBOX/rerun-home" "$MATRIX_SANDBOX/rerun-bin"

run_installer "${CUELOOP_VERSION:-}" "$MATRIX_SANDBOX/rerun-1.log"
check curl-rerun-first "first install failed" test -x "$MATRIX_INSTALL_DIR/cueloop"

run_installer "${CUELOOP_VERSION:-}" "$MATRIX_SANDBOX/rerun-2.log"
status=$?

check curl-rerun-second-exit "second install exited $status" test "$status" -eq 0
contains curl-rerun-already "already installed" "$MATRIX_SANDBOX/rerun-2.log"
if grep -q "downloading" "$MATRIX_SANDBOX/rerun-2.log" 2>/dev/null; then
  bad curl-rerun-no-download "second run downloaded again"
else
  ok curl-rerun-no-download
fi
