---
"cueloop": minor
---

Sharing or serving a workbench thread now freezes a snapshot of the working-tree diff for the remote reviewer, who cannot see your tree. `cueloop share` pins the current diff into the shared artifact (and drops the workbench marker) so the link stays stable no matter how you edit on; `cueloop serve` captures the diff once at serve time and splices it into what each observer reads, while their annotations and the rest of the thread stay live. Your own local session keeps rendering the live working tree.
