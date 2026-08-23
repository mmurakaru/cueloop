#!/bin/sh
# Rebuild libcueloopvt.dylib: libghostty-vt (Ghostty's VT core) statically linked
# behind the flat FFI shim. Pinned to a Ghostty commit + Zig 0.16.0.
# Output lands in native/<os>-<arch>/libcueloopvt.dylib. Requires curl and git.
set -eu

GHOSTTY_COMMIT="5834a0e3df621802e9578e4562d88b0c2ad4ada8"
ZIG_VERSION="0.16.0"

here="$(cd "$(dirname "$0")" && pwd)"
work="${TMPDIR:-/tmp}/cueloop-libghostty-build"
mkdir -p "$work"
export ZIG_GLOBAL_CACHE_DIR="$work/zig-gcache"
export ZIG_LOCAL_CACHE_DIR="$work/zig-lcache"
cd "$work"

# Host triple for the Bun prebuilt dir and Zig download. The two tools use
# different architecture names.
arch="$(uname -m)"; os="$(uname -s | tr '[:upper:]' '[:lower:]')"
case "$os" in darwin) zig_os="macos"; dylib="libcueloopvt.dylib";; linux) zig_os="linux"; dylib="libcueloopvt.so";; *) echo "unsupported os $os" >&2; exit 1;; esac
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

if [ ! -d ghostty ]; then
  echo "== cloning ghostty @ $GHOSTTY_COMMIT =="
  mkdir ghostty && cd ghostty && git init -q
  git remote add origin https://github.com/ghostty-org/ghostty.git
  cd ..
fi
if ! git -C ghostty cat-file -e "$GHOSTTY_COMMIT^{commit}" 2>/dev/null; then
  git -C ghostty fetch -q --depth 1 origin "$GHOSTTY_COMMIT"
fi

# Build only from fresh trees materialized from the verified archive and exact
# Git object. Cached working-tree edits and stale install outputs cannot enter.
build_root="$(mktemp -d "$work/native-build.XXXXXX")"
trap 'rm -rf "$build_root"' EXIT HUP INT TERM
tar -xf "$zig_archive" -C "$build_root"
zig="$build_root/zig-$zig_arch-$zig_os-$ZIG_VERSION/zig"
ghostty_source="$build_root/ghostty"
mkdir "$ghostty_source"
git -C ghostty archive "$GHOSTTY_COMMIT" | tar -x -C "$ghostty_source"

echo "== building libghostty-vt (ReleaseFast) =="
cd "$ghostty_source"
# The final xcframework packaging step can fail while the .a we need is produced,
# so tolerate a non-zero exit here but assert the static lib exists below.
vt_install="$build_root/vt-install"
"$zig" build -Demit-lib-vt -Doptimize=ReleaseFast --prefix "$vt_install" || true
cd ..
staticlib="$vt_install/lib/libghostty-vt.a"
[ -f "$staticlib" ] || { echo "build failed: $staticlib not produced" >&2; exit 1; }

echo "== linking shim -> $outdir/$dylib =="
mkdir -p "$outdir"
if [ "$os" = "darwin" ]; then
  "$zig" build-lib -dynamic -OReleaseFast -lc -femit-bin="$outdir/$dylib" \
    -install_name "@rpath/$dylib" \
    -I"$vt_install/include" "$here/src/shim.zig" "$staticlib" \
    -framework CoreFoundation -framework CoreText -framework CoreGraphics
else
  "$zig" build-lib -dynamic -OReleaseFast -lc -femit-bin="$outdir/$dylib" \
    -I"$vt_install/include" "$here/src/shim.zig" "$staticlib" -lm -lpthread
fi
echo "== done: $outdir/$dylib =="
