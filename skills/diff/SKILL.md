---
name: diff
description: Submit working-tree changes to the cueloop changes panel. Use when the user asks to review your code changes or before committing substantial agent-authored changes.
---

# cueloop diff

Capture the working-tree patch, including untracked files, through the
harness's cueloop `diff` workflow. Submit full changed-file contents when
available so hunk curation stays applyable. The adapter opens the changes
panel and delivers the resolved Message into this conversation. Give the user
the Thread ID so they can reopen it.

File notes may explain intent in plain prose; they are context, not reviewer
feedback. If changes are requested, fix each cited line and submit an updated
diff for review. Native message delivery belongs to the harness adapter.
