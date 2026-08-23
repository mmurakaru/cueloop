---
"cueloop": minor
---

Run the review agent inside the Agent tab, not a separate pane. Picking claude code / pi / codex now embeds a real terminal in the rail: the harness runs on a PTY (bun-pty) through Ghostty's own VT core (libghostty-vt via a small FFI shim) and paints into the OpenTUI canvas cell-by-cell, with colors, text attributes, and a live cursor. While it is focused the keyboard routes to the agent; ctrl+] detaches back to the review. Where no prebuilt libghostty-vt ships for the platform, it falls back to the previous herdr-split launch, so nothing breaks. Ships a darwin-arm64 prebuilt today; other platforms use the split until their prebuilts land.
