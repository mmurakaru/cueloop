#!/bin/sh
# offline-after-install: once installed, the CLI and its local daemon must work
# with no network. Install, warm the daemon once, delete the guest's default
# route, then prove --version and a daemon-backed command still work offline.
set -u
. "$(dirname "$0")/lib.sh"

expect offline-installed offline-route-gone offline-version offline-session

scenario_reset "$MATRIX_SANDBOX/offline-home" "$MATRIX_SANDBOX/offline-bin"

binary="$MATRIX_INSTALL_DIR/cueloop"
run_installer "${CUELOOP_VERSION:-}" "$MATRIX_SANDBOX/offline-install.log"
check offline-installed "install failed" test -x "$binary"

# warm the daemon while the network is still up
env HOME="$MATRIX_HOME" CUELOOP_HOME="$MATRIX_HOME" "$binary" session list >/dev/null 2>&1 || true

# cut the network: drop the default route inside the guest
ip route del default 2>/dev/null || true
if ip route show default 2>/dev/null | grep -q default; then
  bad offline-route-gone "default route still present"
else
  ok offline-route-gone
fi

check offline-version "--version failed offline" "$binary" --version
if env HOME="$MATRIX_HOME" CUELOOP_HOME="$MATRIX_HOME" "$binary" session list >"$MATRIX_SANDBOX/offline-session.log" 2>&1; then
  ok offline-session
else
  bad offline-session "cueloop session list failed with no network"
fi
