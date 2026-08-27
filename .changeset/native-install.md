---
"cueloop": patch
---

Add a `build:binary` script that compiles cueloop into a self-contained executable with `bun build --compile`, bundling the Bun runtime so the binary needs neither Node nor a separate Bun. A release workflow builds one binary per platform (darwin-arm64, darwin-x64, linux-x64, linux-arm64) and attaches them, with a `checksums.txt`, to the GitHub Release. A curl installer served at `cueloop.dev/install.sh` and a Homebrew formula download those binaries, so `curl -fsSL https://cueloop.dev/install.sh | sh` and `brew install cueloop` install onto a stable PATH that survives Node version switches.
