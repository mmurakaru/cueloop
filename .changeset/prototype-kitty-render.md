---
"cueloop": patch
---

Prototype review now renders the page. The screenshot is painted directly through the kitty graphics protocol into a reserved cell region (transmit once, re-place after each frame, beneath the text layer) rather than OpenTUI's image renderable, which stayed blank in some terminals; the capture viewport matches the box's cell aspect so the image fills it. Typing a comment no longer leaks to the global keymap - the compose textarea owns the keyboard while open and Enter saves. Adds an end-to-end test covering click -> actions bar -> comment -> save -> rail.
