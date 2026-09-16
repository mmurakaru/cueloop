---
"cueloop": minor
---

The workbench now has a unified pane focus model: exactly one of Threads, Thread, Changes, or Project owns the keyboard, shown by a selected-item backdrop that moves with the arrow keys or `j`/`k` and opens with Enter or Tab. Sidebar navigation no longer moves the caret in the open thread. A rebindable command leader reaches structural commands, and the leader then Tab cycles focus between panes. The project tree and the changed-files tree navigate by keyboard when focused, and the editor split control is a floating popover you drive with the arrow keys. Menus are single-open, so opening one closes any other. Rounding out the pass: the pinned sidebar section is now Starred, dialogs capture focus on open and dismiss on an outside click, empty states are centered, the footer branch truncates rather than wraps, and the pointer no longer sticks in text selection after the terminal drops mouse reporting.
