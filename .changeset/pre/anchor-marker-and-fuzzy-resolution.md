---
"cueloop": patch
---

Stop annotations from orphaning when their quote carries a leading markdown marker, and re-bind lightly edited quotes. The parser strips block markers (`- `, `## `, `1. `, `> `) from block text, so a quote copied verbatim from the source - bullet and all - never matched the exact/trimmed lookup and dropped straight to an orphaned anchor. The anchor resolver now runs a longer cascade: exact -> trimmed -> marker-normalized -> fuzzy -> orphan. Marker stripping shares one `stripLeadingBlockMarker` utility with the parser so the two cannot drift, and the fuzzy tier (`levenshteinDistance` / `similarityRatio` / `fuzzyFindBestMatch`, standalone in `@cueloop/schema`) re-anchors a quote after a small edit, gated by a high similarity floor so it never binds to the wrong text. Fixing this in the resolver heals anchors already stored in a session and covers every author path (local, agent, gateway).
