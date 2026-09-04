---
"@cueloop/schema": patch
"@cueloop/daemon": patch
"@cueloop/client": patch
"cueloop": patch
---

The owner walks a session's history tree from the command line: `cueloop session label`, `branch`, `switch`, `navigate`, and `fork`, plus `cueloop share --fork` to hand a fork to a second teammate. What the session shows follows the current branch's path; comments the path no longer reaches are shelved rather than deleted, and the agent's next revision lands on `main` wherever its tip was moved. A fork copies the path's revisions, open comments, labels, and participant names into a new pending session that names its parent.
