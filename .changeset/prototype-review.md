---
"cueloop": patch
---

Add prototype review: `cueloop prototype <file.html>` renders an HTML prototype with headless Chromium and shows it as an image in the review sheet. Click a rendered element - a design-system card, say - to select it (the click resolves to the nearest component element), and the marker actions bar and compose card annotate that element by CSS selector. The verdict feedback locates each comment by its selector. Needs a graphics-capable terminal (kitty or ghostty) and an installed Google Chrome; other terminals show a capability notice. A new `prototype` skill lets an agent submit a prototype for non-blocking review.
