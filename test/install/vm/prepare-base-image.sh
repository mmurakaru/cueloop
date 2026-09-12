#!/bin/sh
# prepare-base-image.sh <arch>: fetch the pinned Firecracker binary, guest
# kernel, and base rootfs, verify each against pins.json, then build a base ext4
# image with systemd-networkd configured and zsh and fish added. Prints the
# resulting paths as KEY=value lines for controller.sh to read.
#
# prepare-base-image.sh --update-pins <arch>: fetch without verifying, record
# each artifact's sha256 back into pins.json, and exit. Run this once on a
# KVM-capable Linux box to populate an unpinned pins.json, then commit the diff.
#
# All downloads go to $CACHE_DIR (default /work/cache) via a .partial file so a
# half-download is never mistaken for complete.
set -eu

CACHE_DIR="${CACHE_DIR:-/work/cache}"
PINS="${PINS:-/work/pins.json}"
WORK="${WORK:-/work}"

update_pins=0
if [ "${1:-}" = "--update-pins" ]; then
  update_pins=1
  shift
fi
arch="${1:?prepare-base-image.sh needs an arch (x64 or arm64)}"

mkdir -p "$CACHE_DIR"

pin_field() {
  jq -r ".arch.\"$arch\".$1.$2" "$PINS"
}

sha256_of() {
  sha256sum "$1" | awk '{print $1}'
}

# fetch <url> <dest> <expected-sha-or-empty>: download once, then verify. In
# normal mode an empty expected hash is a hard failure: the harness refuses to
# use an unpinned artifact. Only --update-pins may download without a hash.
fetch() {
  url="$1"
  dest="$2"
  expected="$3"

  if [ -f "$dest" ]; then
    return 0
  fi
  if [ "$update_pins" -eq 0 ] && [ -z "$expected" ]; then
    echo "refusing to fetch unpinned artifact $url; run with --update-pins to record its sha256" >&2
    exit 1
  fi
  echo "downloading $url" >&2
  curl -fsSL "$url" -o "$dest.partial"
  if [ -n "$expected" ] && [ "$update_pins" -eq 0 ]; then
    actual="$(sha256_of "$dest.partial")"
    if [ "$actual" != "$expected" ]; then
      echo "checksum mismatch for $url: expected $expected got $actual" >&2
      exit 1
    fi
  fi
  mv "$dest.partial" "$dest"
}

# record <component> <file>: write the file's sha256 into pins.json.
record() {
  hash="$(sha256_of "$2")"
  tmp="$(mktemp)"
  jq ".arch.\"$arch\".$1.sha256 = \"$hash\"" "$PINS" >"$tmp"
  mv "$tmp" "$PINS"
  echo "pinned $arch.$1 = $hash" >&2
}

fc_tgz="$CACHE_DIR/firecracker-$arch.tgz"
kernel="$CACHE_DIR/vmlinux-$arch"
rootfs_squashfs="$CACHE_DIR/rootfs-$arch.squashfs"

fetch "$(pin_field firecracker url)" "$fc_tgz" "$(pin_field firecracker sha256)"
fetch "$(pin_field kernel url)" "$kernel" "$(pin_field kernel sha256)"
fetch "$(pin_field rootfs url)" "$rootfs_squashfs" "$(pin_field rootfs sha256)"

if [ "$update_pins" -eq 1 ]; then
  record firecracker "$fc_tgz"
  record kernel "$kernel"
  record rootfs "$rootfs_squashfs"
  echo "pins updated; review and commit pins.json" >&2
  exit 0
fi

# extract the firecracker binary from its release tarball
fc_member="$(pin_field firecracker member)"
tar -xzf "$fc_tgz" -C "$CACHE_DIR" "$fc_member"
fc_bin="$CACHE_DIR/firecracker"
cp "$CACHE_DIR/$fc_member" "$fc_bin"
chmod +x "$fc_bin"

# unpack the rootfs, configure networking, and add the shells the rc scenario needs
rootfs_dir="$WORK/rootfs"
rm -rf "$rootfs_dir"
unsquashfs -d "$rootfs_dir" "$rootfs_squashfs" >/dev/null

mkdir -p "$rootfs_dir/etc/systemd/network"
cat >"$rootfs_dir/etc/systemd/network/10-eth0.network" <<'NETEOF'
[Match]
Name=eth0

[Network]
Address=172.16.0.2/30
Gateway=172.16.0.1
DNS=172.16.0.1
NETEOF

# let the controller SSH in as root with the ephemeral key
mkdir -p "$rootfs_dir/etc/ssh/sshd_config.d" "$rootfs_dir/root/.ssh"
cat >"$rootfs_dir/etc/ssh/sshd_config.d/10-install-vm.conf" <<'SSHEOF'
PermitRootLogin prohibit-password
PubkeyAuthentication yes
SSHEOF
# make sure the ssh server starts on boot
chmod 700 "$rootfs_dir/root/.ssh"

# provision the guest rootfs: a downloader the installer needs, the shells the
# shell-rc scenario needs, an ssh server, host keys, and the boot units enabled.
# This runs once at image-build time with host network, so a failure here is a
# hard failure, not a warning that later shows up as "guest did not come up".
cp /etc/resolv.conf "$rootfs_dir/etc/resolv.conf" 2>/dev/null || true
chroot "$rootfs_dir" /bin/sh -ec "
  apt-get update
  apt-get install -y --no-install-recommends curl ca-certificates zsh fish openssh-server
  ssh-keygen -A
  systemctl enable ssh systemd-networkd
"

# build a 4 GiB ext4 image populated from the rootfs directory
base_ext4="$WORK/base.ext4"
rm -f "$base_ext4"
mkfs.ext4 -q -F -L rootfs -d "$rootfs_dir" "$base_ext4" 4G

echo "FC_BIN=$fc_bin"
echo "KERNEL=$kernel"
echo "BASE_EXT4=$base_ext4"
