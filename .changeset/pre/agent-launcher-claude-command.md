---
"cueloop": patch
---

Fix the Claude harness never launching from the Agent tab. Its command was `cc`, which is a personal shell alias for `claude` - but the embedded terminal spawns the binary directly on a PTY, where `cc` resolves to the system C compiler, so the pane ran the compiler instead of Claude Code (`pi` and `codex` are real binaries, so they worked). The command is now `claude`. Also strips the `▸` glyphs from the launcher buttons and plan-context toggle, and removes the inline `(⌃])` detach hint from the running-terminal header - the detach chord is now listed in the Keybinds cheatsheet (Settings) under "Agent terminal" instead. Detaching now tears the terminal down explicitly (the React reconciler detaches a child without destroying it), so the agent's child process no longer leaks after ctrl+].
