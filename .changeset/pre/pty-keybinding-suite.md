---
"cueloop": patch
---

Test and CI only: a PTY keybinding suite presses every chord the thread view cheatsheet advertises against the real TUI and fails on any chord without a screen expectation or a documented reason it is unwired. The PTY tier now runs in CI on the Apple silicon runner and against the compiled darwin-arm64 binary in the release build. ctrl chords with enter, tab, backspace, and escape are encoded in the xterm modifyOtherKeys form the app's input parser accepts. No shipped behavior changes.
