---
---

Test-only: stop the suite from leaking herdr tabs. When `bun run test` runs inside a herdr pane, the child spawns inherited `HERDR_ENV=1`, so every black-box `cueloop session create` and every hook subprocess called the real `herdr tab create` and opened a tab in the developer's live session. Test subprocess spawns now empty the herdr env (`HERMETIC_HERDR_ENV` in `test/helpers/env.ts`), disabling the integration exactly as the suite already empties `CLAUDE_CODE_MESSAGING_SOCKET` for the ambient inbox. No shipped behavior changes; herdr open/focus stays covered by the stub-binary tests.
