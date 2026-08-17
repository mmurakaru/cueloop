---
"@cueloop/client": minor
---

The default theme no longer paints the canvas or flat chrome: `bg` and
`panel` default to `transparent`, so the terminal's own background (and any
transparency or blur it renders) shows through. Floating surfaces (dialogs,
walk cards) now sit on the `elevated` token and stay opaque. Set `[theme]`
`bg`/`panel` overrides in the user config for an opaque look.
