---
"@cueloop/schema": patch
"@cueloop/daemon": patch
"@cueloop/client": patch
"cueloop": patch
---

A share follows one named branch (`main` by default) and carries that branch's entry log, so a collaborator sees the branch's plan wherever the owner has navigated their own view. A collaborator removing their own comment records a removal entry that reaches the owner and every other collaborator through the same additive union - the note is shelved, never erased - and merging a share applies each removal once by its entry id. The owner navigating another branch does not change what collaborators see.
