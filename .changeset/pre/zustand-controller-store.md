---
"cueloop": patch
---

The review controller's state runs on a zustand store instead of a hand-rolled subscribe/emit, so the app no longer maintains its own state-management plumbing. Behaviour is unchanged; the store backs the same snapshot the views read.
