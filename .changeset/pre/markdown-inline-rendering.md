---
"cueloop": patch
---

Render inline Markdown in the review surface. Prose now shows real emphasis - **strong**, *emphasis*, `code`, ~~strikethrough~~, and [links](url) - with the markup markers concealed, blockquotes muted, and headings bold with the level (h1/h2/h3) shown by descending brightness (a terminal cannot scale font size), leaving the salmon accent to annotations. Links become clickable OSC 8 terminal hyperlinks (http(s)/mailto only). The styling is produced by a new pure inline tokenizer in `@cueloop/schema` that emits each visible span at its exact source offset and drops the markers, so quote anchors, mouse selection, and keyboard-span selection stay character-precise - annotations resolve against the same text as before, and emphasis composes with word-diff on edited blocks.
