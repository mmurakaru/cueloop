---
"cueloop": minor
---

The review panel now resizes and collapses so the plan gets the width it needs. It cycles through three states with `b`: expanded (the full annotation rail), compact (a narrow strip that keeps the count and one kind-colored dot per annotation - accent for a comment, green for a suggestion), and hidden (gone entirely, so the plan takes the full terminal, reopened with the same key and no leftover tab). Drag the single-column divider between the plan and the rail to resize the expanded width, or nudge it with `[` and `]`; the divider accents while you drag and the width is clamped to a sensible range. A muted chevron on the panel's edge toggles expanded and compact with a click (`»` to collapse, `«` to expand). The collapse state and rail width persist to `[ui] review_state` and `[ui] review_width` in your config, so the layout you pick survives a restart.
