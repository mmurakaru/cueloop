#!/bin/sh
# curl-clean: the curl installer on a machine without Node or Bun on PATH.
# Proves the binary installs, runs, verifies its checksum, and puts itself on
# PATH through the shell rc. The host sets CUELOOP_* to point at the release
# under test (public URLs for the weekly run, a local server for the gate).
set -u
. "$(dirname "$0")/../lib.sh"

expect curl-clean-exit curl-clean-executable curl-clean-version \
  curl-clean-help curl-clean-checksum curl-clean-rc

scenario_reset "$MATRIX_SANDBOX/clean-home" "$MATRIX_SANDBOX/clean-bin"

# a real login shell so the rc-file path runs, and rc edits left on
MATRIX_SHELL=/bin/bash
MATRIX_NO_MODIFY_PATH=""
run_installer "${CUELOOP_VERSION:-}" "$MATRIX_SANDBOX/clean.log"
status=$?

check curl-clean-exit "installer exited $status" test "$status" -eq 0
binary="$MATRIX_INSTALL_DIR/cueloop"
check curl-clean-executable "no executable at $binary" test -x "$binary"
check curl-clean-version "--version did not run" "$binary" --version
if "$binary" --help 2>&1 | head -n 1 | grep -q "Usage: cueloop"; then
  ok curl-clean-help
else
  bad curl-clean-help "--help did not start with 'Usage: cueloop'"
fi
contains curl-clean-checksum "verifying checksum" "$MATRIX_SANDBOX/clean.log"
if grep -qE "PATH in|$MATRIX_INSTALL_DIR" "$MATRIX_HOME/.bashrc" 2>/dev/null; then
  ok curl-clean-rc
else
  bad curl-clean-rc "install dir not added to .bashrc"
fi
