---
"cueloop": minor
---

Reach the thread's structural commands through a nav mode instead of a leader chord. In the thread you type to comment, as before; press esc for nav mode - the footer switches to the commands - and a bare letter runs one: e edit, s share, enter submit, n/p move between comments, x cut, u restore, r rename, and the diff and tree letters. Every command is a bare key with no prefix and no modifier, so the terminal never swallows one and there is nothing to set up. Tab and shift+tab cycle the panes. The old ctrl+g leader is gone; cmd/ctrl+enter, ctrl+e, and ctrl+s stay as accelerators.

The mode hint is one line above the focused surface's footer, a diff rejects a change with a single x, and the submit card opens on approve by default (set `[ui] default_verdict` to change it). The inline plan editor keeps the pane's left inset and saves with ctrl+enter. A focused comment fills its marker-rail dot, not just the card border. The unwired tree-view toggle is dropped from nav until the history view lands. The nav footer names only the commands the surface can run, so the Welcome tab and a project file offer comment and fold rather than the diff commands. The keybinds dialog no longer lists an agent terminal detach chord, which had nothing behind it.
