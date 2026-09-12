---
"cueloop": patch
---

An install matrix that verifies every published install path. Six scenario scripts, written in pure POSIX so they run on a bare distribution, drive the curl installer on a clean machine, on a rerun, and across an upgrade, plus the global npm package, the Homebrew formula, and the plugin manifest. A weekly workflow runs them on hosted macOS and Linux, on Windows, and inside Debian, Fedora, Arch, and Alpine containers against the real published release, and files a tracking issue when a scheduled run fails. The release workflow serves the freshly staged binaries from a local release tree and runs the curl scenarios against them before publish, so a broken installer blocks the release. No user-visible behavior changes.
