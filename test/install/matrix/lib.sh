# Assertion helpers for install-matrix scenarios. A scenario sources this,
# runs an installer, and records one tab-separated row per checked fact to
# $MATRIX_ASSERTIONS: "<id>\t<pass|fail>\t<detail>". The host (run.ts) reads
# the rows, checks each scenario's required evidence, and aggregates.
#
# Pure POSIX sh so a scenario runs unchanged in an Alpine container with no
# Node and no Bun.
set -u

: "${MATRIX_ASSERTIONS:?set MATRIX_ASSERTIONS to the file to append rows to}"
: "${MATRIX_INSTALLER:?set MATRIX_INSTALLER to the install.sh path}"
: "${MATRIX_SANDBOX:?set MATRIX_SANDBOX to a scratch directory}"

# record <id> <pass|fail> <detail>
record() {
  printf '%s\t%s\t%s\n' "$1" "$2" "$3" >>"$MATRIX_ASSERTIONS"
}

ok() { record "$1" pass ""; }
bad() { record "$1" fail "$2"; }

# check <id> <detail-on-fail> <command...>: pass when the command exits zero.
check() {
  id="$1"
  detail="$2"
  shift 2
  if "$@" >/dev/null 2>&1; then ok "$id"; else bad "$id" "$detail"; fi
}

# contains <id> <needle> <file>: pass when the file holds the needle.
contains() {
  if grep -qF "$2" "$3" 2>/dev/null; then ok "$1"; else bad "$1" "missing '$2'"; fi
}

# sha256_of <file>: the hex digest, using whichever tool is present.
sha256_of() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | awk '{print $1}'
  else
    shasum -a 256 "$1" | awk '{print $1}'
  fi
}

# expect <id>...: declare the evidence ids this scenario must record. On exit,
# any declared id with no recorded row becomes a synthetic failure. This makes
# evidence-completeness part of the shared scenario contract, so run.ts and the
# toolchain-free run.sh both enforce it, and a scenario that aborts mid-way
# (an unbound variable, a crash) fails loudly instead of passing silently.
MATRIX_EXPECTED=""
expect() {
  MATRIX_EXPECTED="${MATRIX_EXPECTED} $*"
}

matrix_finalize() {
  for expected_id in ${MATRIX_EXPECTED}; do
    if ! cut -f1 "$MATRIX_ASSERTIONS" | grep -qx "$expected_id"; then
      record "$expected_id" fail "no evidence recorded"
    fi
  done
}
trap matrix_finalize EXIT

# scenario_reset <home> <install-dir>: point MATRIX_HOME and MATRIX_INSTALL_DIR
# at fresh, empty directories for one scenario run.
scenario_reset() {
  MATRIX_HOME="$1"
  MATRIX_INSTALL_DIR="$2"
  rm -rf "$MATRIX_HOME" "$MATRIX_INSTALL_DIR"
  mkdir -p "$MATRIX_HOME"
}

# run_installer <version> <log>: run install.sh hermetically into MATRIX_HOME and
# MATRIX_INSTALL_DIR, pinned to <version>, with all output in <log>. `env -i`
# gives a clean environment so nothing from the CI host leaks in. A scenario may
# set MATRIX_SHELL (default /bin/sh, which writes no bash rc) and
# MATRIX_NO_MODIFY_PATH (default 1; set empty to let the installer edit the rc).
run_installer() {
  env -i \
    HOME="$MATRIX_HOME" \
    TERM=dumb \
    PATH="/usr/bin:/bin" \
    SHELL="${MATRIX_SHELL:-/bin/sh}" \
    CUELOOP_INSTALL_DIR="$MATRIX_INSTALL_DIR" \
    CUELOOP_NO_MODIFY_PATH="${MATRIX_NO_MODIFY_PATH-1}" \
    CUELOOP_DOWNLOAD_BASE="${CUELOOP_DOWNLOAD_BASE:-}" \
    CUELOOP_RELEASES_API="${CUELOOP_RELEASES_API:-}" \
    CUELOOP_VERSION="$1" \
    sh "$MATRIX_INSTALLER" >"$2" 2>&1
}
