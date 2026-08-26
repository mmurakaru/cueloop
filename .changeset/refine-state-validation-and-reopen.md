---
"cueloop": patch
---

Harden refine's persisted state and skip-seen. `refine-state.json` and the `[cleanup] period_days` config value are now parsed with valibot instead of ad-hoc casts, so malformed state or a mistyped config value falls back cleanly. refine keys its skip-seen state on a per-session fingerprint (revision count, annotation count, resolved timestamp) rather than a bare id set, so a resolved session that is reopened and resolved again with new feedback is re-analyzed instead of being skipped forever.
