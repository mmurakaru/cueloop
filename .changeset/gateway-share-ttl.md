---
---

Enforce the advertised 30-day share expiry in the sharing gateway (closes #269). The store now stamps each blob on write and treats it as gone once the retention window passes, counted from the last write so an active share does not expire under its owner; an R2 lifecycle rule reclaims the expired objects. The sharing security docs are reworded to match what the code enforces. No shipped package changes - the gateway is a private service.
