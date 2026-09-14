---
"cueloop": minor
---

The Changes panel now renders a file's working-tree diff on a bare `cueloop` launch, before any thread exists. Clicking a changed file in the Changes tree opens its diff (red/green for a modified file, all-additions for a new one) instead of read-only contents; the Project tree still opens contents. The first comment on a bare-launch diff promotes the per-repo workbench thread and anchors the note, as before. The diff renderer (`GridTabContent`) is shared between the thread workbench and the bare-launch shell so a changed file looks and behaves the same in both.
