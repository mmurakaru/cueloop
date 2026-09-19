#!/bin/sh
# no-downloader: with neither curl nor wget on PATH the installer fails with a
# clear message; with wget alone it succeeds. This VM is disposable, so the
# scenario moves the downloaders aside in place. lib.sh is copied in beside it.
set -u
. "$(dirname "$0")/lib.sh"

expect nodl-neither-fails nodl-wget-succeeds

hide_tool() {
  for dir in /usr/bin /bin; do
    if [ -e "$dir/$1" ]; then mv "$dir/$1" "$dir/$1.hidden" 2>/dev/null || true; fi
  done
}

restore_tool() {
  for dir in /usr/bin /bin; do
    if [ -e "$dir/$1.hidden" ]; then mv "$dir/$1.hidden" "$dir/$1" 2>/dev/null || true; fi
  done
}

hide_tool curl
hide_tool wget

scenario_reset "$MATRIX_SANDBOX/nodl-home" "$MATRIX_SANDBOX/nodl-bin"
run_installer "${CUELOOP_VERSION:-}" "$MATRIX_SANDBOX/nodl-neither.log"
status=$?
if [ "$status" -ne 0 ] && grep -q "need curl or wget" "$MATRIX_SANDBOX/nodl-neither.log"; then
  ok nodl-neither-fails
else
  bad nodl-neither-fails "expected a clear 'need curl or wget' failure, exit was $status"
fi

# now allow wget alone
restore_tool wget
scenario_reset "$MATRIX_SANDBOX/nodl-wget-home" "$MATRIX_SANDBOX/nodl-wget-bin"
run_installer "${CUELOOP_VERSION:-}" "$MATRIX_SANDBOX/nodl-wget.log"
status=$?
if [ "$status" -eq 0 ] && [ -x "$MATRIX_INSTALL_DIR/cueloop" ]; then
  ok nodl-wget-succeeds
else
  bad nodl-wget-succeeds "wget-only install failed, exit was $status"
fi
