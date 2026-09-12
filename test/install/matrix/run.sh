#!/bin/sh
# Bare-distro matrix runner: run each named scenario and fail if a scenario
# script errored or recorded any failing assertion. Pure POSIX and zero
# toolchain, so it runs in a minimal container that has only curl and
# coreutils - exactly the "does `curl | sh` work on a bare distro" question.
#
# run.ts is the richer host used where an offline release must be served from
# built artifacts and a JUnit report produced (the release gate). Both drive
# the same scenario scripts, so the test logic has one home.
#
#   sh test/install/matrix/run.sh curl-clean curl-rerun plugin
set -u

here="$(cd "$(dirname "$0")" && pwd)"
repo_root="$(cd "$here/../../.." && pwd)"

export MATRIX_INSTALLER="${MATRIX_INSTALLER:-$repo_root/site/public/install.sh}"
export MATRIX_REPO_ROOT="$repo_root"

status=0
for name in "$@"; do
  sandbox="$(mktemp -d "${TMPDIR:-/tmp}/install-matrix-${name}.XXXXXX")"
  export MATRIX_SANDBOX="$sandbox"
  export MATRIX_ASSERTIONS="$sandbox/assertions.tsv"
  : >"$MATRIX_ASSERTIONS"

  if ! sh "$here/scenarios/${name}.sh"; then
    echo "FAIL ${name}: scenario script exited non-zero"
    status=1
  fi

  if awk -F'\t' -v scenario="$name" '$2 == "fail" { print "FAIL " scenario ": " $1 " " $3; failed = 1 } END { exit failed ? 1 : 0 }' "$MATRIX_ASSERTIONS"; then
    echo "PASS ${name}"
  else
    status=1
  fi

  rm -rf "$sandbox"
done

exit $status
