---
"cueloop": patch
---

Make the prototype review surface fast and align its comment composer with plan mode. The screenshot is transmitted under one fixed kitty placement id so each frame replaces that placement instead of stacking a new one (the growing lag/ghosting on interaction); selecting an element no longer re-screenshots the page through Chromium (the popover is the selection feedback, as in plan mode); the divider drag only re-renders when the rail width actually changes a column; the headless Chromium is kept warm and reused across opens instead of cold-starting each time; the page load waits for `load` rather than `networkidle0`'s fixed idle window; the capture is sized to the region's real pixels; and an opt-in out-of-band file transfer (`CUELOOP_KITTY_FILE=1`, local only) sends the PNG as a temp-file path instead of base64 through the pty. The prototype composer now cancels on escape, matching the plan composer.
