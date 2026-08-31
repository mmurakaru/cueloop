---
"cueloop": patch
---

The release lane now verifies the published result: every package must be on the registry at the released version, and the CLI must install from npm and run. A publish that reports success but leaves something unusable fails the release run instead of reaching users.
