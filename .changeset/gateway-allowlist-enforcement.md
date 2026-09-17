---
"cueloop": minor
---

The gateway now enforces the private-share allowlist: a private share renders only for a collaborator who authenticated a GitHub identity and whose verified login is on the allowlist (matched case-insensitively). Anyone else is refused before the shared view opens. Public shares are unchanged.
