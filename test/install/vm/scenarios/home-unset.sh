#!/bin/sh
# home-unset: running the installer with no HOME must fail with a clear message,
# not a stack trace or a silent write to the wrong place.
set -u
. "$(dirname "$0")/lib.sh"

expect home-unset-fails home-unset-message

log="$MATRIX_SANDBOX/home-unset.log"
env -i PATH="/usr/bin:/bin" TERM=dumb \
  CUELOOP_DOWNLOAD_BASE="${CUELOOP_DOWNLOAD_BASE:-}" \
  CUELOOP_RELEASES_API="${CUELOOP_RELEASES_API:-}" \
  CUELOOP_VERSION="${CUELOOP_VERSION:-}" \
  sh "$MATRIX_INSTALLER" >"$log" 2>&1
status=$?

if [ "$status" -ne 0 ]; then ok home-unset-fails; else bad home-unset-fails "installer exited 0 with no HOME"; fi
if grep -q "HOME is not set" "$log"; then
  ok home-unset-message
else
  bad home-unset-message "no clear 'HOME is not set' message"
fi
