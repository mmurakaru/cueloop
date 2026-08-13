---
"cueloop": patch
---

Bordered frames now read their corner style from one design-system token, `FRAME_BORDER_STYLE`, instead of each frame hardcoding its own value. Cards, dialogs, and the stories gallery chrome all resolve their rounded corners from this single source of truth, so the frame look can never drift between surfaces. Buttons stay text-first and borderless - the frame they sit in carries the border, not the button.
