---
---

Marketing site only: stop the landing page from scrolling horizontally on mobile. Overflow that reaches the `html` box (a composited animated child escaping an ancestor's `overflow:hidden` on some mobile browsers) slipped past the `body`-level clip, so the page could scroll sideways into empty space. A root-level `overflow-x: clip` on `html` catches it; `clip` keeps the sticky header working and creates no scroll container. No shipped package behavior changes.
