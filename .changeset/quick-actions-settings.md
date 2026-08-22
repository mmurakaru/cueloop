---
"cueloop": minor
---

Add a Settings "Actions" category to edit the quick-action vocabulary. Each quick action is a row whose prompt, when clicked, expands a focused input for its system prompt (the guidance appended when the action is used); a reset-to-defaults control and an add-action row bracket the list. Edits persist to `[[actions]]` in the user config, so the presets a human picks and the ones an agent references via `annotate --action` stay one shared, editable set.
