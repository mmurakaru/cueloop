---
"cueloop": patch
---

The curl installer is idempotent (an exact version match downloads nothing), accepts `CUELOOP_VERSION` as a bare version or a tag, adds its install directory to your shell rc once (or to GITHUB_PATH in Actions), takes `--no-modify-path` and `--help`, and reads `CUELOOP_RELEASES_API` and `CUELOOP_DOWNLOAD_BASE` so mirrors and tests can point it at another server. It runs nothing until its last line, so a truncated `curl | sh` dies on a parse error instead of running a prefix. The install docs list every option, and the nix tab is gone until a flake exists. Tests cover every failure path offline against a local release server, on Linux and macOS.
