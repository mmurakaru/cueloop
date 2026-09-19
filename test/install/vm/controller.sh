#!/bin/sh
# controller.sh: PID 1 inside the install-vm container. It builds the base image,
# serves the offline release, and for each scenario boots a fresh Firecracker
# microVM, runs the scenario over SSH, and copies its assertions back out. The
# container runs privileged: building the rootfs and booting a VM need it.
#
# The guest reaches the fixture server at 172.16.0.1 through the installer's
# CUELOOP_DOWNLOAD_BASE and CUELOOP_RELEASES_API, so no script is rewritten.
set -eu

ARCH="${INSTALL_VM_ARCH:?controller needs INSTALL_VM_ARCH}"
SCENARIOS="${INSTALL_VM_SCENARIOS:?controller needs INSTALL_VM_SCENARIOS}"
WORK=/work
RUNS="$WORK/runs"
DISKS="$WORK/disks"
FIXTURE_PORT=8000
HOST_IP=172.16.0.1
GUEST_IP=172.16.0.2

mkdir -p "$RUNS" "$DISKS"

# --- base image and fixtures ------------------------------------------------
eval "$(sh "$WORK/prepare-base-image.sh" "$ARCH")"
: "${FC_BIN:?prepare-base-image did not report FC_BIN}"
: "${KERNEL:?prepare-base-image did not report KERNEL}"
: "${BASE_EXT4:?prepare-base-image did not report BASE_EXT4}"

# --- host networking for the guests -----------------------------------------
# the tap address must exist before the fixture server binds to it
ip tuntap add tap0 mode tap 2>/dev/null || true
ip addr add "$HOST_IP/30" dev tap0 2>/dev/null || true
ip link set tap0 up
sysctl -w net.ipv4.ip_forward=1 >/dev/null 2>&1 || true

# --- offline release server -------------------------------------------------
python3 -m http.server "$FIXTURE_PORT" --bind "$HOST_IP" --directory "$WORK/fixtures" >/dev/null 2>&1 &
fixture_pid=$!

# --- ephemeral SSH key ------------------------------------------------------
key="$WORK/id_ed25519"
ssh-keygen -t ed25519 -N "" -f "$key" -q
SSH_OPTS="-o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o ConnectTimeout=5 -i $key"

download_base="http://$HOST_IP:$FIXTURE_PORT"
releases_api="$download_base/releases.json"

# version environment handed to every guest; each scenario uses what it needs.
# The MATRIX_* names mirror the contract runner.ts sets for the matrix host.
guest_env() {
  cat <<ENV
export MATRIX_ASSERTIONS=/root/assertions.tsv
export MATRIX_INSTALLER=/root/install.sh
export MATRIX_SANDBOX=/root/sandbox
export MATRIX_REPO_ROOT=/root
export CUELOOP_DOWNLOAD_BASE=$download_base
export CUELOOP_RELEASES_API=$releases_api
export CUELOOP_VERSION=${CUELOOP_VM_GOOD_VERSION:-}
export CUELOOP_MATRIX_PREVIOUS_VERSION=${CUELOOP_VM_PREVIOUS_VERSION:-}
export CUELOOP_VM_GOOD_VERSION=${CUELOOP_VM_GOOD_VERSION:-}
export CUELOOP_VM_BAD_CHECKSUM_VERSION=${CUELOOP_VM_BAD_CHECKSUM_VERSION:-}
export CUELOOP_VM_TRUNCATED_VERSION=${CUELOOP_VM_TRUNCATED_VERSION:-}
export CUELOOP_VM_MISSING_ASSET_VERSION=${CUELOOP_VM_MISSING_ASSET_VERSION:-}
ENV
}

# --- one scenario in a fresh VM ---------------------------------------------
run_scenario() {
  scenario="$1"
  disk="$DISKS/$scenario.ext4"
  sock="$WORK/$scenario.sock"
  out="$RUNS/$scenario"
  mkdir -p "$out"

  # a fresh copy of the base disk, reflinked when the filesystem supports it
  cp --reflink=auto "$BASE_EXT4" "$disk"

  # inject the public key so the controller can SSH in
  debugfs -w -R "mkdir /root/.ssh" "$disk" >/dev/null 2>&1 || true
  debugfs -w -R "write $key.pub /root/.ssh/authorized_keys" "$disk" >/dev/null 2>&1

  cat >"$WORK/$scenario.json" <<CFG
{
  "boot-source": { "kernel_image_path": "$KERNEL", "boot_args": "console=ttyS0 reboot=k panic=1 pci=off root=/dev/vda rw" },
  "drives": [ { "drive_id": "rootfs", "path_on_host": "$disk", "is_root_device": true, "is_read_only": false } ],
  "machine-config": { "vcpu_count": 2, "mem_size_mib": 2048 },
  "network-interfaces": [ { "iface_id": "eth0", "host_dev_name": "tap0", "guest_mac": "06:00:AC:10:00:02" } ]
}
CFG

  rm -f "$sock"
  "$FC_BIN" --api-sock "$sock" --config-file "$WORK/$scenario.json" >"$out/firecracker.log" 2>&1 &
  fc_pid=$!

  # wait for SSH, up to 90 seconds
  up=0
  i=0
  while [ "$i" -lt 90 ]; do
    if ssh $SSH_OPTS "root@$GUEST_IP" true 2>/dev/null; then
      up=1
      break
    fi
    i=$((i + 1))
    sleep 1
  done

  if [ "$up" -eq 0 ]; then
    printf '%s\tfail\t%s\n' "$scenario-boot" "guest did not come up in 90s" >"$out/assertions.tsv"
    kill "$fc_pid" 2>/dev/null || true
    rm -f "$disk" "$sock"
    return
  fi

  # stage the installer, the shared contract, and the scenario
  ssh $SSH_OPTS "root@$GUEST_IP" "mkdir -p /root/sandbox /root/scenario" 2>/dev/null
  scp $SSH_OPTS "$WORK/install.sh" "root@$GUEST_IP:/root/install.sh" >/dev/null 2>&1
  scp $SSH_OPTS "$WORK/lib.sh" "root@$GUEST_IP:/root/scenario/lib.sh" >/dev/null 2>&1
  scp $SSH_OPTS "$WORK/scenarios/$scenario.sh" "root@$GUEST_IP:/root/scenario/$scenario.sh" >/dev/null 2>&1

  # run it under a hard timeout, from a minimal PATH the scenarios expect
  guest_env | ssh $SSH_OPTS "root@$GUEST_IP" "cat >/root/env.sh"
  ssh $SSH_OPTS "root@$GUEST_IP" \
    ". /root/env.sh; PATH=/usr/bin:/bin timeout 600 sh /root/scenario/$scenario.sh" \
    >"$out/scenario.log" 2>&1 || true

  # collect the recorded assertions
  scp $SSH_OPTS "root@$GUEST_IP:/root/assertions.tsv" "$out/assertions.tsv" >/dev/null 2>&1 || \
    printf '%s\tfail\t%s\n' "$scenario-collect" "no assertions.tsv produced" >"$out/assertions.tsv"

  kill "$fc_pid" 2>/dev/null || true
  rm -f "$disk" "$sock"
}

for scenario in $SCENARIOS; do
  echo "=== $scenario ===" >&2
  run_scenario "$scenario"
done

kill "$fixture_pid" 2>/dev/null || true
