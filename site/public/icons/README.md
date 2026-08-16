# Icons

[Lucide](https://lucide.dev) icons, one SVG per file, served from `/icons/<name>.svg`.

They are used as CSS `mask-image` sources so a single file can be recoloured per
context via `background: currentColor` (see the `--icon` custom property in
`src/styles/global.css`). Because they are masks, the `stroke` colour in the file
is irrelevant.

To add one: copy the SVG from lucide.dev into `<name>.svg` here, then reference it
with `--icon: url("/icons/<name>.svg")`.

| File | Lucide name | Used for |
|---|---|---|
| `lightbulb.svg` | lightbulb | tip callout |
| `info.svg` | info | note callout (default) |
| `triangle-alert.svg` | triangle-alert | warning callout |
| `circle-x.svg` | circle-x | danger callout |
| `book-open.svg` | book-open | page summary box |
| `graduation-cap.svg` | graduation-cap | "You'll learn" box |
| `square-pen.svg` | square-pen | contribute-to-this-page link |
| `panel-left.svg` | panel-left | sidebar collapse trigger |
| `copy.svg` | copy | copy-page button |
| `chevron-down.svg` | chevron-down | copy-page dropdown |
