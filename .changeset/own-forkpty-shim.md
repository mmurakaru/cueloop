---
"cueloop": patch
---

Replace the third-party `bun-pty` dependency with an in-house forkpty FFI shim. The embedded Agent-tab terminal needs a PTY, and node-pty's N-API addon crashes Bun on macOS arm64 - so it relied on `bun-pty`, a low-adoption, single-maintainer 0.x package whose Rust native lib we loaded over FFI. We now own that ~150 lines of C (`packages/client/native/src/pty.c`, built by `build-pty.sh` with plain clang - no Zig/Ghostty toolchain) behind `packages/client/src/pty.ts`, removing the external native code from the supply chain. Same ABI shape (spawn/read/write/resize/kill), same fallback: where no prebuilt ships, the launcher degrades to a herdr split. Verified end-to-end via the PTY e2e suite (alt-screen render, raw-tty key routing, SIGWINCH resize, exit code).
