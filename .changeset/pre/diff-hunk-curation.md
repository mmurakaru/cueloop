---
"cueloop": patch
"@cueloop/schema": patch
---

Diff hunk curation: while reviewing a working-tree diff, the owner can accept or reject individual hunks and changes in the terminal. `x` rejects (or restores) the change under the cursor, `⇧X` the whole hunk; rejected lines render struck through and dimmed. The curated result - the accepted changes only - becomes the review's working copy and flows to the agent as feedback, serialized as an exactly applyable unified diff.

To make that exact, `cueloop diff` now captures the full old/new contents of every changed file (new optional `Artifact.files`), and curation re-parses each file with `@pierre/diffs` so a reject reverts precisely the chosen hunk or change. PR reviews carry a partial patch with no file contents, so curation stays disabled there with a clear status message.
