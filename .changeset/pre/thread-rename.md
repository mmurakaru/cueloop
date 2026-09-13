---
"cueloop": patch
---

Rename the internal `ReviewSession` type to `Thread`, the product's word for the artifact you review: the schema interface, the daemon store and record validators, and the client controller module all follow. The JSON-RPC `session.*` methods and the `cueloop session` CLI verbs are unchanged, so installed agent adapters and scripts keep working. `session.comment` joins as the primary annotate method; `session.annotate` stays as an accepted alias.
