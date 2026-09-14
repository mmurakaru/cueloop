---
"cueloop": minor
---

Each launch opens in a pane layout chosen by how it started. `cueloop diff` and `cueloop review` open the Changes diff zoomed and front-and-centre; `cueloop plan` and `cueloop reply` fill the middle with the thread pane and close the right region. A bare `cueloop` remembers the last layout you left, restoring which sidebars were open and whether the Changes panel was zoomed, and falls back to the inbox with the diff zoomed on first run. Opening a specific thread by id keeps letting that thread drive its own panes. The remembered layout persists to `[ui] layout` in the config.
