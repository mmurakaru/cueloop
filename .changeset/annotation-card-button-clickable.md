---
"cueloop": patch
---

Fix the Save and Cancel buttons in a saved annotation card's edit composer, which did nothing when clicked. The card is wrapped in a clickable box (`onMouseUp` selects/activates it), and a button press bubbled up to that box after firing, so activating the card immediately re-opened the editor and undid the action. Word-buttons now stop propagation on press, so a button inside any clickable surface consumes its own click instead of double-firing the ancestor.
