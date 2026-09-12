---
"cueloop": patch
---

`cueloop update` now resolves its install target from the real on-disk executable (`process.execPath`) instead of `argv[1]`, which in a Bun single-file executable is the virtual `/$bunfs/root/cueloop` path. That path made the installer try to write into a read-only filesystem (`mkdir: /$bunfs: Read-only file system`), breaking every self-update. The command also learns the installed version: it reports the current version, checks the newest published release, and short-circuits with `cueloop is up to date (<version>)` when nothing newer exists (never downgrading), printing a restart notice after a successful update. A new `cueloop update --dry-run` reports the resolved target without any network work.
