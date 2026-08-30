---
"@cueloop/client": patch
---

App test suites isolate the user config: a shared test helper points the
config path into the test home, so local runs no longer read the
developer's real config (a persisted review_state made char-frame tests
time out locally while CI passed).
