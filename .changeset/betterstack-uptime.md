---
---

Add `scripts/setup-betterstack.ts` - config-as-code for the gateway's Layer 1 uptime monitors (issue #167): a TCP check on `cueloop.dev:22` and an HTTPS check on `www.cueloop.dev` with certificate-expiry alerting, created idempotently against the Better Stack API. Ops tooling only; no shipped package changes.
