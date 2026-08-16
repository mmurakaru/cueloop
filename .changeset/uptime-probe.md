---
---

CI-only: add an account-free external uptime probe (GitHub Actions, ADR 0007 Layer 1 stopgap). A scheduled job checks the gateway `cueloop.dev:22` and `https://www.cueloop.dev` from GitHub's infra - so it still reports when the box is down - and opens one deduplicated `uptime-alert` issue on failure. Cruder than a purpose-built monitor (cron lag, no status page); retire it once UptimeRobot is set up per the runbook. No shipped behavior changes.
