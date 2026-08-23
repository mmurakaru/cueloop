#!/bin/sh
# Rebuild libcueloopvt.dylib: libghostty-vt (Ghostty's VT core) statically linked
# behind the flat FFI shim in src/shim.c. Pinned to a Ghostty commit + Zig 0.16.0.
# Output lands in native/<os>-<arch>/libcueloopvt.dylib. Requires curl, git, clang.
set -eu

GHOSTTY_COMMIT="5834a0e3df621802e9578e4562d88b0c2ad4ada8"
ZIG_VERSION="0.16.0"

here="$(cd "$(dirname "$0")" && pwd)"
work="${TMPDIR:-/tmp}/cueloop-libghostty-build"
mkdir -p "$work"
cd "$work"

# host triple for the prebuilt dir + zig download
arch="$(uname -m)"; os="$(uname -s | tr '[:upper:]' '[:lower:]')"
case "$os" in darwin) zig_os="macos"; dylib="libcueloopvt.dylib";; linux) zig_os="linux"; dylib="libcueloopvt.so";; *) echo "unsupported os $os" >&2; exit 1;; esac
outdir="$here/${os}-${arch}"

if [ ! -x "zig-$arch-$zig_os-$ZIG_VERSION/zig" ]; then
  echo "== fetching zig $ZIG_VERSION =="
  curl -sSL -o zig.tar.xz "https://ziglang.org/download/$ZIG_VERSION/zig-$arch-$zig_os-$ZIG_VERSION.tar.xz"
  tar -xf zig.tar.xz
fi
zig="$work/zig-$arch-$zig_os-$ZIG_VERSION/zig"

if [ ! -d ghostty ]; then
  echo "== cloning ghostty @ $GHOSTTY_COMMIT =="
  mkdir ghostty && cd ghostty && git init -q
  git remote add origin https://github.com/ghostty-org/ghostty.git
  git fetch -q --depth 1 origin "$GHOSTTY_COMMIT"
  git checkout -q FETCH_HEAD
  cd ..
fi

echo "== building libghostty-vt (ReleaseFast) =="
cd ghostty
ZIG_GLOBAL_CACHE_DIR="$work/zig-gcache" ZIG_LOCAL_CACHE_DIR="$work/zig-lcache" \
  "$zig" build -Demit-lib-vt -Doptimize=ReleaseFast --prefix "$work/vt-install" || true
cd ..

echo "== linking shim -> $outdir/$dylib =="
mkdir -p "$outdir"
clang -O2 -dynamiclib -o "$outdir/$dylib" "$here/src/shim.c" \
  -I"$work/vt-install/include" "$work/vt-install/lib/libghostty-vt.a" \
  -framework CoreFoundation -framework CoreText -framework CoreGraphics
echo "== done: $outdir/$dylib =="
