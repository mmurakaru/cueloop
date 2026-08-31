---
"@cueloop/schema": minor
"@cueloop/daemon": minor
"@cueloop/adapters": minor
"cueloop": minor
---

Any cueloop primitive can now return its verdict into a live pi session. The schema's artifact types become one runtime union (ARTIFACT_TYPES); daemon wire validation, `cueloop session create --type`, and the pi extension's request_review tool all derive their supported set from it. request_review takes `content` plus an optional `type` (default plan) and `title`, keeping the same waiter map, write gate, and shutdown abort for every primitive. A resubmit under the same agent session id only revises a session of the same artifact type, and a reply review's feedback document references reply.md.
