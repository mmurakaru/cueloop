---
---

Test-only: close the last herdr-tab leak. Subprocess spawns were already made hermetic, but in-process tests (e.g. `hook.test.ts` calling `runHook` -> `openHerdrPaneForReview`) read `process.env` directly, so a suite run from inside a herdr pane still spawned real `herdr tab create` and left "Open Plan"/"Approve Me"/"Changes Me" tabs behind. A bun test preload (`bunfig.toml` -> `test/preload.ts`) now neutralizes the ambient herdr env in `process.env` for every test process. Tests that exercise herdr on purpose still set their own stub env. No shipped behavior changes.
