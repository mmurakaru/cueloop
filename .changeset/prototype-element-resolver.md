---
"cueloop": patch
---

Anchor a prototype click on the interactive control it lands on. Clicking a button, link, or input inside a container (e.g. a button in a design-system grid) previously resolved to the nearest multi-child named container, so the marker popover floated over the container instead of the control. The resolver now returns the closest `button`/`a`/`[role=button]`/`input`/`select`/`textarea`/`label`/`summary` when the click is on one, falling back to the component-climb for generic content.
