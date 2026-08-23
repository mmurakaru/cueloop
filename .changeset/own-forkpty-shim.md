---
"cueloop": patch
---

The embedded Agent-tab terminal now drives its child through cueloop's own forkpty(3) FFI shim. The shim is a small `native/src/pty.zig` (spawn / non-blocking read / write / resize / reap) built by `build-pty.sh` with the same pinned Zig toolchain as the VT shim, loaded over `bun:ffi` from `packages/client/src/pty.ts`. This drops the last external native dependency, so all native code the client loads is now built and owned in-tree. Same graceful fallback as before: where no prebuilt shim ships for the platform, the launcher degrades to a herdr split. Verified end-to-end via the PTY e2e suite (alternate-screen render, raw-tty key routing, SIGWINCH resize, exit code).
