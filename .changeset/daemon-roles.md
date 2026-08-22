---
"cueloop": minor
---

Enforce owner / collaborator / agent roles at the daemon socket. A connection is the owner by default (local single-user is unchanged); a review-side agent connects with `--role agent` (a `daemon.hello` handshake), and the daemon then caps it to reading the session and adding annotations - any attempt to resolve, submit a revision, edit, cut, share, or delete is refused. The capability map is one source of truth (`capabilities.ts`). The `cueloop:annotate` skill now passes `--role agent`, so a bring-your-own agent literally cannot escalate.
