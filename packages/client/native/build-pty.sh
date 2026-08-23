#!/bin/sh
# Build libcuelooppty: the flat forkpty(3) FFI shim in src/pty.c. Pure libc, so
# this is a plain clang compile - no Zig or Ghostty toolchain (unlike build.sh).
# Output lands in native/<os>-<arch>/libcuelooppty.{dylib,so}. Requires clang.
set -eu

here="$(cd "$(dirname "$0")" && pwd)"
arch="$(uname -m)"
os="$(uname -s | tr '[:upper:]' '[:lower:]')"
case "$os" in
  darwin) dylib="libcuelooppty.dylib";;
  linux) dylib="libcuelooppty.so";;
  *) echo "unsupported os $os" >&2; exit 1;;
esac
outdir="$here/${os}-${arch}"
mkdir -p "$outdir"

echo "== compiling pty shim -> $outdir/$dylib =="
if [ "$os" = "darwin" ]; then
  # forkpty lives in libSystem on macOS; no extra link flag needed.
  clang -O2 -dynamiclib -o "$outdir/$dylib" "$here/src/pty.c"
else
  # forkpty is in libutil on glibc/musl.
  clang -O2 -shared -fPIC -o "$outdir/$dylib" "$here/src/pty.c" -lutil
fi
echo "== done: $outdir/$dylib =="
