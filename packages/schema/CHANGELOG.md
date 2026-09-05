# @cueloop/schema

## 0.1.0-alpha.66

### Minor Changes

- [#336](https://github.com/mmurakaru/cueloop/pull/336) [`8889294`](https://github.com/mmurakaru/cueloop/commit/88892948ecbc37caf94e9ef01a5d53750afc2364) Thanks [@mmurakaru](https://github.com/mmurakaru)! - Reshape the review surface into an edgy app shell. The sidebar groups reviews into Projects and Threads keyed by a location-proof repo identity that survives moving or re-cloning the repo, and jumps between threads beside the thread view. The thread footer carries the repo and branch with a send-message control, brand-purple accents and nerd-font icons run throughout, and `cueloop dev` opens the TUI on an isolated home seeded with example threads.

## 0.1.0-alpha.65

### Minor Changes

- [#327](https://github.com/mmurakaru/cueloop/pull/327) [`3199a76`](https://github.com/mmurakaru/cueloop/commit/3199a76ec6af4fd6cc8c38a451522224c11229ea) Thanks [@mmurakaru](https://github.com/mmurakaru)! - A review session's history is a tree of entries.

  - Every write records an entry: the root revision, each new comment and each removal, each verdict, each merged collaborator comment, and each agent revision on `main`.
  - Branches are named tips, checkpoints are labelled entries, and the artifact text and open comments derive from the active path; navigating and forking are pure operations on the history, ready for their primitives.
  - Records written before histories existed migrate to a one-branch tree on read; a record with no revision keeps reading without one.
  - Session storage sits behind one contract with a conformance suite run against the file store and an in-memory adapter.

- [#324](https://github.com/mmurakaru/cueloop/pull/324) [`dcbd48d`](https://github.com/mmurakaru/cueloop/commit/dcbd48d2325e74230b7911038b0c51a0a2e3449b) Thanks [@mmurakaru](https://github.com/mmurakaru)! - Thread view, discussions, spanning anchors, and realtime share sync.

  - An anchor may span consecutive blocks: the quote joins the blocks with a blank line, the end block travels as a hint, and resolution maps a match back to its start and end block.
  - A reply carries `replyTo`, the id of the root comment it answers, and shares its anchor; the feedback document renders a discussion as one item with its replies in time order.
  - Behind `CUELOOP_THREAD_VIEW=1`, plans and replies open in the thread view: character-precise marks across rows and blocks, type-to-comment, inline discussion cards, folding, the quick-action palette, and scroll markers; the keybinds dialog lists the grammar.
  - Shares sync live: the gateway store notifies every viewer of a change, collaborators refresh in place, and the owner follows the share over a `cueloop-watch` stream with reconnect instead of polling.
  - Every callable action is a primitive; the gateway share metrics label is `primitive` instead of `verb`.

### Patch Changes

- [#331](https://github.com/mmurakaru/cueloop/pull/331) [`1b8253c`](https://github.com/mmurakaru/cueloop/commit/1b8253c0f2159e99244e1fdae9a3350eabb68055) Thanks [@mmurakaru](https://github.com/mmurakaru)! - Cutting a plan block, restoring it, rejecting diff hunks, and marking files as viewed are daemon primitives. The TUI routes every one of them through the daemon, so an agent or a script can shape the artifact the same way a reviewer does: `cueloop session cut`, `restore`, `curate`, and `set-viewed`. Reject decisions live on the session, and each change appends a reviewer revision to the history.

- [#335](https://github.com/mmurakaru/cueloop/pull/335) [`3adc09e`](https://github.com/mmurakaru/cueloop/commit/3adc09e5294ef384872c1a8e578231c65ce76ce4) Thanks [@mmurakaru](https://github.com/mmurakaru)! - A share follows one named branch (`main` by default) and carries that branch's entry log, so a collaborator sees the branch's plan wherever the owner has navigated their own view. A collaborator removing their own comment records a removal entry that reaches the owner and every other collaborator through the same additive union - the note is shelved, never erased - and merging a share applies each removal once by its entry id. The owner navigating another branch does not change what collaborators see.

- [#332](https://github.com/mmurakaru/cueloop/pull/332) [`8e56045`](https://github.com/mmurakaru/cueloop/commit/8e56045b6081a851a757cf33b676382c04c07446) Thanks [@mmurakaru](https://github.com/mmurakaru)! - The owner walks a session's history tree from the command line: `cueloop session label`, `branch`, `switch`, `navigate`, and `fork`, plus `cueloop share --fork` to hand a fork to a second teammate. What the session shows follows the current branch's path; comments the path no longer reaches are shelved rather than deleted, and the agent's next revision lands on `main` wherever its tip was moved. A fork copies the path's revisions, open comments, labels, and participant names into a new pending session that names its parent.

## 0.1.0-alpha.64

## 0.1.0-alpha.63

### Minor Changes

- [#303](https://github.com/mmurakaru/cueloop/pull/303) [`17d2789`](https://github.com/mmurakaru/cueloop/commit/17d278988d2c65f7e1e5e635fc103c5de79f961a) Thanks [@mmurakaru](https://github.com/mmurakaru)! - Any cueloop primitive can now return its verdict into a live pi session. The schema's artifact types become one runtime union (ARTIFACT_TYPES); daemon wire validation, `cueloop session create --type`, and the pi extension's request_review tool all derive their supported set from it. request_review takes `content` plus an optional `type` (default plan) and `title`, keeping the same waiter map, write gate, and shutdown abort for every primitive. A resubmit under the same agent session id only revises a session of the same artifact type, and a reply review's feedback document references reply.md.

## 0.1.0-alpha.62

### Minor Changes

- Annotations collapse to a single `comment` kind. The `s` suggest keybinding is gone (the key is now unbound), and the suggestion "Replace/With" feedback rendering is removed - every annotation serializes as a comment. Working-copy edits and hunk curation already give a stronger, directly-applied way to propose a concrete change, so the suggestion kind was redundant.

  BREAKING (alpha) for `@cueloop/schema`: `AnnotationKind` no longer lists `"suggestion"`. The kind set stays open (`"comment" | (string & {})`) for forward-compat with agent notes and other kinds.

### Patch Changes

- Diff hunk curation: while reviewing a working-tree diff, the owner can accept or reject individual hunks and changes in the terminal. `x` rejects (or restores) the change under the cursor, `⇧X` the whole hunk; rejected lines render struck through and dimmed. The curated result - the accepted changes only - becomes the review's working copy and flows to the agent as feedback, serialized as an exactly applyable unified diff.

  To make that exact, `cueloop diff` now captures the full old/new contents of every changed file (new optional `Artifact.files`), and curation re-parses each file with `@pierre/diffs` so a reject reverts precisely the chosen hunk or change. PR reviews carry a partial patch with no file contents, so curation stays disabled there with a clear status message.

- The diff review sheet now highlights the change within a modified line, not just the whole line: a deletion paired with its addition is word-diffed so the removed and added words keep the diff color while the unchanged part of the line dims. The plan tracked-changes view shares the same engine. Both are backed by a single whitespace-lossless word-diff (jsdiff diffWordsWithSpace), replacing the coarser home-grown LCS word diff, so quote anchors stay exact. In a multi-line hunk, lines are aligned to their real counterpart by similarity (not by position), so an inserted or removed line never paints a misleading word diff against an unrelated line.

  BREAKING (alpha): `@cueloop/schema` no longer exports `wordDiff` - it is superseded by the client-side word-diff engine and had no other consumer. `lcsDiff` (its building block) stays exported.

## 0.1.0-alpha.61

### Minor Changes

- Annotations collapse to a single `comment` kind. The `s` suggest keybinding is gone (the key is now unbound), and the suggestion "Replace/With" feedback rendering is removed - every annotation serializes as a comment. Working-copy edits and hunk curation already give a stronger, directly-applied way to propose a concrete change, so the suggestion kind was redundant.

  BREAKING (alpha) for `@cueloop/schema`: `AnnotationKind` no longer lists `"suggestion"`. The kind set stays open (`"comment" | (string & {})`) for forward-compat with agent notes and other kinds.

### Patch Changes

- Diff hunk curation: while reviewing a working-tree diff, the owner can accept or reject individual hunks and changes in the terminal. `x` rejects (or restores) the change under the cursor, `⇧X` the whole hunk; rejected lines render struck through and dimmed. The curated result - the accepted changes only - becomes the review's working copy and flows to the agent as feedback, serialized as an exactly applyable unified diff.

  To make that exact, `cueloop diff` now captures the full old/new contents of every changed file (new optional `Artifact.files`), and curation re-parses each file with `@pierre/diffs` so a reject reverts precisely the chosen hunk or change. PR reviews carry a partial patch with no file contents, so curation stays disabled there with a clear status message.

- The diff review sheet now highlights the change within a modified line, not just the whole line: a deletion paired with its addition is word-diffed so the removed and added words keep the diff color while the unchanged part of the line dims. The plan tracked-changes view shares the same engine. Both are backed by a single whitespace-lossless word-diff (jsdiff diffWordsWithSpace), replacing the coarser home-grown LCS word diff, so quote anchors stay exact. In a multi-line hunk, lines are aligned to their real counterpart by similarity (not by position), so an inserted or removed line never paints a misleading word diff against an unrelated line.

  BREAKING (alpha): `@cueloop/schema` no longer exports `wordDiff` - it is superseded by the client-side word-diff engine and had no other consumer. `lcsDiff` (its building block) stays exported.

## 0.1.0-alpha.60

## 0.1.0-alpha.59

## 0.1.0-alpha.58

## 0.1.0-alpha.57

## 0.1.0-alpha.56

## 0.1.0-alpha.55

## 0.1.0-alpha.54

## 0.1.0-alpha.53

## 0.1.0-alpha.52

## 0.1.0-alpha.51

## 0.1.0-alpha.50

## 0.1.0-alpha.49

## 0.1.0-alpha.48

## 0.1.0-alpha.47

## 0.1.0-alpha.46

## 0.1.0-alpha.45

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
