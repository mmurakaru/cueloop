---
"cueloop": patch
---

The diff review sheet now syntax-highlights code with tree-sitter: keywords, types, strings, and the rest wear their theme colors across context, added, and deleted lines, resolved off the render path so rows draw unstyled first. It composes with the intra-line word diff - a changed word keeps the diff color on top of its syntax color - and leaves the row-level annotation cards untouched. A hunk is highlighted as a contiguous fragment (so multi-line constructs tokenize correctly) and the filetype comes from the file path.
