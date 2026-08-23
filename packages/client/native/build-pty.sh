#!/bin/sh
# Build libcuelooppty: the flat forkpty(3) FFI shim in src/pty.zig. Pure libc, so
# unlike build.sh this needs no Ghostty clone - just the pinned Zig toolchain.
# Output lands in native/<os>-<arch>/libcuelooppty.{dylib,so}. Requires curl.
set -eu

ZIG_VERSION="0.16.0"

here="$(cd "$(dirname "$0")" && pwd)"
work="${TMPDIR:-/tmp}/cueloop-libghostty-build"
mkdir -p "$work"
export ZIG_GLOBAL_CACHE_DIR="$work/zig-gcache"
export ZIG_LOCAL_CACHE_DIR="$work/zig-lcache"
cd "$work"

arch="$(uname -m)"; os="$(uname -s | tr '[:upper:]' '[:lower:]')"
case "$os" in darwin) zig_os="macos"; dylib="libcuelooppty.dylib";; linux) zig_os="linux"; dylib="libcuelooppty.so";; *) echo "unsupported os $os" >&2; exit 1;; esac
case "$arch-$os" in
  arm64-darwin|aarch64-linux) zig_arch="aarch64"; bun_arch="arm64";;
  x86_64-darwin|x86_64-linux) zig_arch="x86_64"; bun_arch="x64";;
  *) echo "unsupported architecture $arch on $os" >&2; exit 1;;
esac
case "$zig_arch-$zig_os" in
  aarch64-macos) zig_sha="b23d70deaa879b5c2d486ed3316f7eaa53e84acf6fc9cc747de152450d401489";;
  x86_64-macos) zig_sha="0387557ed1877bc6a2e1802c8391953baddba76081876301c522f52977b52ba7";;
  aarch64-linux) zig_sha="ea4b09bfb22ec6f6c6ceac57ab63efb6b46e17ab08d21f69f3a48b38e1534f17";;
  x86_64-linux) zig_sha="70e49664a74374b48b51e6f3fdfbf437f6395d42509050588bd49abe52ba3d00";;
esac
outdir="$here/${os}-${bun_arch}"
zig_archive="zig-$zig_arch-$zig_os-$ZIG_VERSION.tar.xz"

if [ ! -f "$zig_archive" ]; then
  echo "== fetching zig $ZIG_VERSION =="
  curl -fsSL -o "$zig_archive" "https://ziglang.org/download/$ZIG_VERSION/$zig_archive"
fi
printf '%s  %s\n' "$zig_sha" "$zig_archive" | shasum -a 256 -c -

build_root="$(mktemp -d "$work/native-pty-build.XXXXXX")"
trap 'rm -rf "$build_root"' EXIT HUP INT TERM
tar -xf "$zig_archive" -C "$build_root"
zig="$build_root/zig-$zig_arch-$zig_os-$ZIG_VERSION/zig"

echo "== building pty shim -> $outdir/$dylib =="
mkdir -p "$outdir"
if [ "$os" = "darwin" ]; then
  "$zig" build-lib -dynamic -OReleaseFast -lc -femit-bin="$outdir/$dylib" \
    -install_name "@rpath/$dylib" "$here/src/pty.zig"
else
  "$zig" build-lib -dynamic -OReleaseFast -lc -femit-bin="$outdir/$dylib" "$here/src/pty.zig"
fi
echo "== done: $outdir/$dylib =="
