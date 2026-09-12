#!/bin/sh
# failure-preservation: a good install must survive every failed reinstall. Seed
# a good binary, then point the installer at a bad-checksum, a truncated, and a
# missing-asset release in turn; each must fail and leave the good binary
# byte-identical with no partial file behind. The controller serves the synthetic
# bad versions and names them in the environment.
set -u
. "$(dirname "$0")/lib.sh"

: "${CUELOOP_VM_GOOD_VERSION:?needs CUELOOP_VM_GOOD_VERSION}"
: "${CUELOOP_VM_BAD_CHECKSUM_VERSION:?needs CUELOOP_VM_BAD_CHECKSUM_VERSION}"
: "${CUELOOP_VM_TRUNCATED_VERSION:?needs CUELOOP_VM_TRUNCATED_VERSION}"
: "${CUELOOP_VM_MISSING_ASSET_VERSION:?needs CUELOOP_VM_MISSING_ASSET_VERSION}"

expect fp-seed fp-badchecksum-preserved fp-truncated-preserved \
  fp-missing-preserved fp-clean-dir

scenario_reset "$MATRIX_SANDBOX/fp-home" "$MATRIX_SANDBOX/fp-bin"

binary="$MATRIX_INSTALL_DIR/cueloop"
run_installer "$CUELOOP_VM_GOOD_VERSION" "$MATRIX_SANDBOX/fp-seed.log"
check fp-seed "good version did not install" test -x "$binary"
good_hash="$(sha256_of "$binary")"

# attempt <evidence-id> <bad-version>: a failed reinstall must not touch the binary
attempt() {
  run_installer "$2" "$MATRIX_SANDBOX/$1.log" || true
  now_hash="$(sha256_of "$binary")"
  if [ "$now_hash" = "$good_hash" ]; then ok "$1"; else bad "$1" "binary changed after failed install of $2"; fi
}

attempt fp-badchecksum-preserved "$CUELOOP_VM_BAD_CHECKSUM_VERSION"
attempt fp-truncated-preserved "$CUELOOP_VM_TRUNCATED_VERSION"
attempt fp-missing-preserved "$CUELOOP_VM_MISSING_ASSET_VERSION"

leftover="$(ls -A "$MATRIX_INSTALL_DIR" | grep -v '^cueloop$' || true)"
if [ -z "$leftover" ]; then ok fp-clean-dir; else bad fp-clean-dir "stray files after failed installs: $leftover"; fi
