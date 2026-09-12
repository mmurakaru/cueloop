#!/bin/sh
# clean-machine: a truly fresh VM with no node, bun, or git on PATH. The binary
# installs, runs, verifies its checksum, and answers a daemon-backed command by
# autostarting a local daemon. The installer itself must leave no daemon running.
# lib.sh is the shared matrix contract, copied in beside this script.
set -u
. "$(dirname "$0")/lib.sh"

expect clean-exit clean-executable clean-version clean-help clean-daemon-idle clean-session

scenario_reset "$MATRIX_SANDBOX/clean-home" "$MATRIX_SANDBOX/clean-bin"

run_installer "${CUELOOP_VERSION:-}" "$MATRIX_SANDBOX/clean.log"
status=$?

check clean-exit "installer exited $status" test "$status" -eq 0
binary="$MATRIX_INSTALL_DIR/cueloop"
check clean-executable "no executable at $binary" test -x "$binary"
check clean-version "--version did not run" "$binary" --version
if "$binary" --help 2>&1 | head -n 1 | grep -q "Usage: cueloop"; then
  ok clean-help
else
  bad clean-help "--help did not start with 'Usage: cueloop'"
fi

# the installer must not spawn or leave a daemon behind
if pgrep -f "cueloop.*daemon" >/dev/null 2>&1; then
  bad clean-daemon-idle "a daemon is running right after install"
else
  ok clean-daemon-idle
fi

# a daemon-backed command autostarts a local daemon and returns
assert_session_command clean-session
