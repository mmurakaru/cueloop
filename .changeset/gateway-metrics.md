---
"cueloop": minor
---

Add an opt-in Prometheus `/metrics` endpoint to the sharing gateway (ADR 0007, Layer 2). Off by default and bound to loopback - it starts only when `CUELOOP_METRICS_PORT` is set, so it never faces the public port and production is unchanged until an operator opts in. It exposes share-verb success/error counts + latency (`cueloop_share_ops_total`, `cueloop_share_op_duration_seconds`) and R2 operation outcomes (`cueloop_r2_ops_total`), the SLIs a scraping agent (e.g. Grafana Cloud) needs. Box CPU/mem/disk stay the agent's node integration.
