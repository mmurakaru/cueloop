---
"cueloop": patch
---

Validate the daemon's socket boundary with valibot: every request is checked before it reaches the session core, malformed input gets an `invalid_params` error naming the offending field, wait timeouts are clamped, and persisted session records are validated on recovery. Verdict kinds are closed; annotation kinds stay open for extensions.
