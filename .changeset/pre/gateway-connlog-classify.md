---
"cueloop": patch
---

Gateway connection-error logging is now classified: expected transport failures (bad handshake, auth abort, connection reset) from internet scanners on port 22 log one terse line instead of a full stack trace, while genuinely unexpected errors stay loud. Cuts log noise without hiding real faults.
