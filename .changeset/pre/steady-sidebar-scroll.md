---
"@cueloop/client": patch
---

Keep selection visible while scrolling Changes and Project trees, show complete file names, restore diff actions and zoomed split view, keep preview tab labels upright, show the TOML-selected review skill, and dismiss toasts on outside click. Clicking the Changes sidebar opens its editor tab beside Welcome or other files. File titles toggle folding with hover guidance, copied paths report success in their tooltip, and split controls remain available in every editor group while zoom stays in the upper-right header at a stable size. Document Enter as the file tree action in Keybinds.

Limit the editor grid to eight tiles and disable splits that would leave a tile too small. Share renderer frame, resize, and keypress subscriptions across tiles so repeated splits do not trigger listener warnings.
