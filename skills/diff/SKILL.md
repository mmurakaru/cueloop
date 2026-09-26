---
name: diff
description: Submit working-tree changes to the cueloop changes panel. Use when the user asks to review your code changes or before committing substantial agent-authored changes.
---

# cueloop diff

Capture the working-tree patch, including untracked files, through the
harness's cueloop `diff` workflow when available. Submit full changed-file
contents so hunk curation stays applyable. Otherwise, write a complete patch
to a file and run `cueloop session create --type diff --content-file <patch>`.
When the patch matches cueloop's checkout capture, the CLI adds exact file
snapshots for curation. Otherwise curation is unavailable. Give the
user the returned Thread ID and collect the Message with
`cueloop session wait <id> --timeout-ms 60000`, repeating while pending.

File notes may explain intent in plain prose; they are context, not reviewer
feedback. If changes are requested, fix each cited line and submit an updated
diff for review with `cueloop session submit-revision <id> --content-file <patch>`
on the CLI path.

In a JJ checkout, capture the native change with `jj diff --git` and pass
`--vcs jj` to the CLI create command. Keep the patch exactly as JJ emitted it;
cueloop can then tie the review to JJ's change ID. In a Git checkout, keep the
existing `git diff HEAD` and untracked-file capture.
