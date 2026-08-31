---
---

Fix the recurring TUI test timeouts on CI. The daemon runs in-process on the same
event loop as the renderer, and the wait helpers drove tight multi-pass render
bursts with only a 1ms yield between them - on a contended CI runner that starved
the daemon's socket read, so an annotate/update round-trip never landed and the
wait hung its whole budget. The helpers now poll gently (one render, one frame
check, one macrotask yield per iteration) so the daemon always gets an IO turn.
Also raises the per-test budgets as headroom. Test-infra only; no runtime change.
