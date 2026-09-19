---
"cueloop": patch
---

Deleting a shared thread now revokes its share: the gateway deletes the encrypted blob so the link stops resolving, best-effort so an unreachable gateway never blocks the local delete. Owners can also stop sharing explicitly from the share menu. Revoke is owner-only (the blob records the planner's key) and idempotent.
