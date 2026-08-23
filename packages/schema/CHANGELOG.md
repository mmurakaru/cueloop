# @cueloop/schema

## 0.1.0-alpha.44

## 0.1.0-alpha.43

## 0.1.0-alpha.42

## 0.1.0-alpha.41

## 0.1.0-alpha.40

## 0.1.0-alpha.39

## 0.1.0-alpha.38

## 0.1.0-alpha.37

## 0.1.0-alpha.36

## 0.1.0-alpha.35

## 0.1.0-alpha.34

### Minor Changes

- [#196](https://github.com/mmurakaru/cueloop/pull/196) [`b241ac8`](https://github.com/mmurakaru/cueloop/commit/b241ac8398871f67a141e909ad72292a8245cadd) Thanks [@mmurakaru](https://github.com/mmurakaru)! - Annotations collapse to a single `comment` kind. The `s` suggest keybinding is gone (the key is now unbound), and the suggestion "Replace/With" feedback rendering is removed - every annotation serializes as a comment. Working-copy edits and hunk curation already give a stronger, directly-applied way to propose a concrete change, so the suggestion kind was redundant.

  BREAKING (alpha) for `@cueloop/schema`: `AnnotationKind` no longer lists `"suggestion"`. The kind set stays open (`"comment" | (string & {})`) for forward-compat with agent notes and other kinds.

### Patch Changes

- [#193](https://github.com/mmurakaru/cueloop/pull/193) [`8d8abab`](https://github.com/mmurakaru/cueloop/commit/8d8ababc2c44b3a7352f18c7341af01d23f6042a) Thanks [@mmurakaru](https://github.com/mmurakaru)! - Diff hunk curation: while reviewing a working-tree diff, the owner can accept or reject individual hunks and changes in the terminal. `x` rejects (or restores) the change under the cursor, `⇧X` the whole hunk; rejected lines render struck through and dimmed. The curated result - the accepted changes only - becomes the review's working copy and flows to the agent as feedback, serialized as an exactly applyable unified diff.

  To make that exact, `cueloop diff` now captures the full old/new contents of every changed file (new optional `Artifact.files`), and curation re-parses each file with `@pierre/diffs` so a reject reverts precisely the chosen hunk or change. PR reviews carry a partial patch with no file contents, so curation stays disabled there with a clear status message.

- [#190](https://github.com/mmurakaru/cueloop/pull/190) [`d5ef124`](https://github.com/mmurakaru/cueloop/commit/d5ef124532a4e5137cc0a6ca8a1bf7b8dee840e1) Thanks [@mmurakaru](https://github.com/mmurakaru)! - The diff review sheet now highlights the change within a modified line, not just the whole line: a deletion paired with its addition is word-diffed so the removed and added words keep the diff color while the unchanged part of the line dims. The plan tracked-changes view shares the same engine. Both are backed by a single whitespace-lossless word-diff (jsdiff diffWordsWithSpace), replacing the coarser home-grown LCS word diff, so quote anchors stay exact. In a multi-line hunk, lines are aligned to their real counterpart by similarity (not by position), so an inserted or removed line never paints a misleading word diff against an unrelated line.

  BREAKING (alpha): `@cueloop/schema` no longer exports `wordDiff` - it is superseded by the client-side word-diff engine and had no other consumer. `lcsDiff` (its building block) stays exported.

## 0.1.0-alpha.33

## 0.1.0-alpha.32

## 0.1.0-alpha.31

## 0.1.0-alpha.30

## 0.1.0-alpha.29

## 0.1.0-alpha.28

## 0.1.0-alpha.27

## 0.1.0-alpha.26

## 0.1.0-alpha.25

## 0.1.0-alpha.24

## 0.1.0-alpha.23

## 0.1.0-alpha.22

## 0.1.0-alpha.21

## 0.1.0-alpha.20

## 0.1.0-alpha.19

## 0.1.0-alpha.18

## 0.1.0-alpha.17

## 0.1.0-alpha.16

## 0.1.0-alpha.15

## 0.1.0-alpha.14

## 0.1.0-alpha.13

## 0.1.0-alpha.12

## 0.1.0-alpha.11

## 0.1.0-alpha.10

## 0.1.0-alpha.9

## 0.1.0-alpha.8

## 0.1.0-alpha.7

## 0.1.0-alpha.6

## 0.1.0-alpha.5

## 0.1.0-alpha.4

## 0.1.0-alpha.3

## 0.1.0-alpha.2

## 0.1.0-alpha.1

## 0.1.0-alpha.0
