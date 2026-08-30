---
"cueloop": patch
---

Fix daemon autostart from the standalone binary. The client spawned `bun run main.ts` to launch the daemon, which only resolves from a source or npm install; a compiled binary (the curl and Homebrew install) has no `main.ts` on disk and its `execPath` is the cueloop binary rather than bun, so autostart failed with `daemon did not come up` whenever no daemon was already running - first launch, or after the daemon idle-exits. The client now detects the compiled binary via the Bun virtual-filesystem markers in `import.meta.url` and re-execs `cueloop daemon`.
