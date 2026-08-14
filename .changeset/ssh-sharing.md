---
"cueloop": minor
---

SSH plan sharing: `cueloop share` (and a one-click Share button / ⇧S in the plan TUI) publishes a plan as one line - `ssh p_xxxxxxxx@cueloop.dev` - copied to the clipboard. A teammate pastes it and the plan renders in their terminal, no install, with every annotation already on it. They annotate too, and their notes union back into the shared blob attributed by SSH key, never overwriting the planner's. Backed by a new SSH gateway (raw ssh2, one port, shell renders / exec uploads) that seals each blob (AES-256-GCM, per-blob HKDF key) before it reaches R2. Annotations gain an optional `author` fingerprint; the review controller now renders the same TUI against a local session or a decrypted share.
