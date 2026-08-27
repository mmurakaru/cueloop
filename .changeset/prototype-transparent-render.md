---
"cueloop": patch
---

Render prototype mockups on the terminal's own surface. The mockup page's root background is no longer painted as an opaque box; the render is captured with an alpha channel, so a prototype emerges into whatever theme the terminal is running - its own components composited over the active surface - instead of floating in a fixed grey card.
