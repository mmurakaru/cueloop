# @cueloop/daemon

## 0.1.0-alpha.65

### Minor Changes

- [#329](https://github.com/mmurakaru/cueloop/pull/329) [`d4bfddc`](https://github.com/mmurakaru/cueloop/commit/d4bfddc0057c131c82c46258bc1921e11302e7ad) Thanks [@mmurakaru](https://github.com/mmurakaru)! - Every discussion action has its primitive.

  - `cueloop session annotate --reply-to <comment-id>` replies on the root comment's anchor; `--selector <css>` anchors a prototype comment to an element.
  - `cueloop session remove` removes a comment; a non-owner names the author it acts as and removes only that author's.
  - `cueloop session name-self` registers the display name of an author.
  - `cueloop session events` follows a session as one JSON line per change; every event names the history entry it appended.

- [#328](https://github.com/mmurakaru/cueloop/pull/328) [`6c5fdab`](https://github.com/mmurakaru/cueloop/commit/6c5fdab8ba7098344a051e5a0ef779af783c1249) Thanks [@mmurakaru](https://github.com/mmurakaru)! - Ownership of the daemon is proven, never declared.

  - Every connection starts as a collaborator; the daemon mints an owner token into its home on each run (mode 0600) and the local client presents it on connect.
  - A request to be the owner without the token is refused, so a review-side agent stays capped to reading, waiting, and commenting whatever it sends.
  - The roles of every primitive live in one table that must name each primitive the daemon accepts.

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
- Updated dependencies [[`1b8253c`](https://github.com/mmurakaru/cueloop/commit/1b8253c0f2159e99244e1fdae9a3350eabb68055), [`3199a76`](https://github.com/mmurakaru/cueloop/commit/3199a76ec6af4fd6cc8c38a451522224c11229ea), [`3adc09e`](https://github.com/mmurakaru/cueloop/commit/3adc09e5294ef384872c1a8e578231c65ce76ce4), [`dcbd48d`](https://github.com/mmurakaru/cueloop/commit/dcbd48d2325e74230b7911038b0c51a0a2e3449b), [`8e56045`](https://github.com/mmurakaru/cueloop/commit/8e56045b6081a851a757cf33b676382c04c07446)]:
  - @cueloop/schema@0.1.0-alpha.65

## 0.1.0-alpha.64

### Patch Changes

- [#304](https://github.com/mmurakaru/cueloop/pull/304) [`49feedc`](https://github.com/mmurakaru/cueloop/commit/49feedc74de12b677a13455b18c223743d125691) Thanks [@mmurakaru](https://github.com/mmurakaru)! - Parse untrusted JSON (persisted state, registry documents, external configs) with schemas at every I/O boundary, and enforce the new type-evidence lint rules across the workspace.
- Updated dependencies []:
  - @cueloop/schema@0.1.0-alpha.64

## 0.1.0-alpha.63

### Minor Changes

- [#303](https://github.com/mmurakaru/cueloop/pull/303) [`17d2789`](https://github.com/mmurakaru/cueloop/commit/17d278988d2c65f7e1e5e635fc103c5de79f961a) Thanks [@mmurakaru](https://github.com/mmurakaru)! - Any cueloop primitive can now return its verdict into a live pi session. The schema's artifact types become one runtime union (ARTIFACT_TYPES); daemon wire validation, `cueloop session create --type`, and the pi extension's request_review tool all derive their supported set from it. request_review takes `content` plus an optional `type` (default plan) and `title`, keeping the same waiter map, write gate, and shutdown abort for every primitive. A resubmit under the same agent session id only revises a session of the same artifact type, and a reply review's feedback document references reply.md.

### Patch Changes

- Updated dependencies [[`17d2789`](https://github.com/mmurakaru/cueloop/commit/17d278988d2c65f7e1e5e635fc103c5de79f961a)]:
  - @cueloop/schema@0.1.0-alpha.63

## 0.1.0-alpha.62

### Patch Changes

- Enforce a cyclomatic complexity limit of 20 (oxlint) and refactor the functions that exceeded it - the intent dispatcher, keymap reducer, config layering, App, plan-sheet run-style, the CLI command routers, and the daemon dispatch - into small, table-driven units. Behavior and public APIs are unchanged.
- Updated dependencies []:
  - @cueloop/schema@0.1.0-alpha.62

## 0.1.0-alpha.61

### Patch Changes

- Enforce a cyclomatic complexity limit of 20 (oxlint) and refactor the functions that exceeded it - the intent dispatcher, keymap reducer, config layering, App, plan-sheet run-style, the CLI command routers, and the daemon dispatch - into small, table-driven units. Behavior and public APIs are unchanged.
- Updated dependencies []:
  - @cueloop/schema@0.1.0-alpha.61

## 0.1.0-alpha.60

### Patch Changes

- Updated dependencies []:
  - @cueloop/schema@0.1.0-alpha.60

## 0.1.0-alpha.59

### Patch Changes

- [#278](https://github.com/mmurakaru/cueloop/pull/278) [`8523940`](https://github.com/mmurakaru/cueloop/commit/852394000ba356c159b21097e46cf8036a6ebf21) Thanks [@mmurakaru](https://github.com/mmurakaru)! - Enforce a cyclomatic complexity limit of 20 (oxlint) and refactor the functions that exceeded it - the intent dispatcher, keymap reducer, config layering, App, plan-sheet run-style, the CLI command routers, and the daemon dispatch - into small, table-driven units. Behavior and public APIs are unchanged.

- Updated dependencies []:
  - @cueloop/schema@0.1.0-alpha.59

## 0.1.0-alpha.58

### Patch Changes

- Updated dependencies []:
  - @cueloop/schema@0.1.0-alpha.58

## 0.1.0-alpha.57

### Patch Changes

- Updated dependencies []:
  - @cueloop/schema@0.1.0-alpha.57

## 0.1.0-alpha.56

### Patch Changes

- Updated dependencies []:
  - @cueloop/schema@0.1.0-alpha.56

## 0.1.0-alpha.55

### Patch Changes

- Updated dependencies []:
  - @cueloop/schema@0.1.0-alpha.55

## 0.1.0-alpha.54

### Patch Changes

- Updated dependencies []:
  - @cueloop/schema@0.1.0-alpha.54

## 0.1.0-alpha.53

### Patch Changes

- Updated dependencies []:
  - @cueloop/schema@0.1.0-alpha.53

## 0.1.0-alpha.52

### Patch Changes

- Updated dependencies []:
  - @cueloop/schema@0.1.0-alpha.52

## 0.1.0-alpha.51

### Patch Changes

- Updated dependencies []:
  - @cueloop/schema@0.1.0-alpha.51

## 0.1.0-alpha.50

### Patch Changes

- Updated dependencies []:
  - @cueloop/schema@0.1.0-alpha.50

## 0.1.0-alpha.49

### Patch Changes

- Updated dependencies []:
  - @cueloop/schema@0.1.0-alpha.49

## 0.1.0-alpha.48

### Patch Changes

- Updated dependencies []:
  - @cueloop/schema@0.1.0-alpha.48

## 0.1.0-alpha.47

### Patch Changes

- Updated dependencies []:
  - @cueloop/schema@0.1.0-alpha.47

## 0.1.0-alpha.46

### Patch Changes

- Updated dependencies []:
  - @cueloop/schema@0.1.0-alpha.46

## 0.1.0-alpha.45

### Patch Changes

- Updated dependencies []:
  - @cueloop/schema@0.1.0-alpha.45

## 0.1.0-alpha.44

### Patch Changes

- Updated dependencies []:
  - @cueloop/schema@0.1.0-alpha.44

## 0.1.0-alpha.43

### Patch Changes

- Updated dependencies []:
  - @cueloop/schema@0.1.0-alpha.43

## 0.1.0-alpha.42

### Patch Changes

- Updated dependencies []:
  - @cueloop/schema@0.1.0-alpha.42

## 0.1.0-alpha.41

### Patch Changes

- Updated dependencies []:
  - @cueloop/schema@0.1.0-alpha.41

## 0.1.0-alpha.40

### Patch Changes

- Updated dependencies []:
  - @cueloop/schema@0.1.0-alpha.40

## 0.1.0-alpha.39

### Patch Changes

- Updated dependencies []:
  - @cueloop/schema@0.1.0-alpha.39

## 0.1.0-alpha.38

### Patch Changes

- Updated dependencies []:
  - @cueloop/schema@0.1.0-alpha.38

## 0.1.0-alpha.37

### Patch Changes

- Updated dependencies []:
  - @cueloop/schema@0.1.0-alpha.37

## 0.1.0-alpha.36

### Patch Changes

- Updated dependencies []:
  - @cueloop/schema@0.1.0-alpha.36

## 0.1.0-alpha.35

### Patch Changes

- Updated dependencies []:
  - @cueloop/schema@0.1.0-alpha.35

## 0.1.0-alpha.34

### Patch Changes

- Updated dependencies [[`8d8abab`](https://github.com/mmurakaru/cueloop/commit/8d8ababc2c44b3a7352f18c7341af01d23f6042a), [`b241ac8`](https://github.com/mmurakaru/cueloop/commit/b241ac8398871f67a141e909ad72292a8245cadd), [`d5ef124`](https://github.com/mmurakaru/cueloop/commit/d5ef124532a4e5137cc0a6ca8a1bf7b8dee840e1)]:
  - @cueloop/schema@0.1.0-alpha.34

## 0.1.0-alpha.33

### Patch Changes

- Updated dependencies []:
  - @cueloop/schema@0.1.0-alpha.33

## 0.1.0-alpha.32

### Patch Changes

- Updated dependencies []:
  - @cueloop/schema@0.1.0-alpha.32

## 0.1.0-alpha.31

### Patch Changes

- Updated dependencies []:
  - @cueloop/schema@0.1.0-alpha.31

## 0.1.0-alpha.30

### Patch Changes

- Updated dependencies []:
  - @cueloop/schema@0.1.0-alpha.30

## 0.1.0-alpha.29

### Patch Changes

- Updated dependencies []:
  - @cueloop/schema@0.1.0-alpha.29

## 0.1.0-alpha.28

### Patch Changes

- Updated dependencies []:
  - @cueloop/schema@0.1.0-alpha.28

## 0.1.0-alpha.27

### Patch Changes

- Updated dependencies []:
  - @cueloop/schema@0.1.0-alpha.27

## 0.1.0-alpha.26

### Patch Changes

- Updated dependencies []:
  - @cueloop/schema@0.1.0-alpha.26

## 0.1.0-alpha.25

### Patch Changes

- Updated dependencies []:
  - @cueloop/schema@0.1.0-alpha.25

## 0.1.0-alpha.24

### Patch Changes

- Updated dependencies []:
  - @cueloop/schema@0.1.0-alpha.24

## 0.1.0-alpha.23

### Patch Changes

- Updated dependencies []:
  - @cueloop/schema@0.1.0-alpha.23

## 0.1.0-alpha.22

### Patch Changes

- Updated dependencies []:
  - @cueloop/schema@0.1.0-alpha.22

## 0.1.0-alpha.21

### Patch Changes

- Updated dependencies []:
  - @cueloop/schema@0.1.0-alpha.21

## 0.1.0-alpha.20

### Patch Changes

- Updated dependencies []:
  - @cueloop/schema@0.1.0-alpha.20

## 0.1.0-alpha.19

### Patch Changes

- Updated dependencies []:
  - @cueloop/schema@0.1.0-alpha.19

## 0.1.0-alpha.18

### Patch Changes

- Updated dependencies []:
  - @cueloop/schema@0.1.0-alpha.18

## 0.1.0-alpha.17

### Patch Changes

- Updated dependencies []:
  - @cueloop/schema@0.1.0-alpha.17

## 0.1.0-alpha.16

### Patch Changes

- Updated dependencies []:
  - @cueloop/schema@0.1.0-alpha.16

## 0.1.0-alpha.15

### Patch Changes

- Updated dependencies []:
  - @cueloop/schema@0.1.0-alpha.15

## 0.1.0-alpha.14

### Patch Changes

- Updated dependencies []:
  - @cueloop/schema@0.1.0-alpha.14

## 0.1.0-alpha.13

### Patch Changes

- Updated dependencies []:
  - @cueloop/schema@0.1.0-alpha.13

## 0.1.0-alpha.12

### Patch Changes

- Updated dependencies []:
  - @cueloop/schema@0.1.0-alpha.12

## 0.1.0-alpha.11

### Patch Changes

- Updated dependencies []:
  - @cueloop/schema@0.1.0-alpha.11

## 0.1.0-alpha.10

### Patch Changes

- Updated dependencies []:
  - @cueloop/schema@0.1.0-alpha.10

## 0.1.0-alpha.9

### Patch Changes

- Updated dependencies []:
  - @cueloop/schema@0.1.0-alpha.9

## 0.1.0-alpha.8

### Patch Changes

- Updated dependencies []:
  - @cueloop/schema@0.1.0-alpha.8

## 0.1.0-alpha.7

### Patch Changes

- Updated dependencies []:
  - @cueloop/schema@0.1.0-alpha.7

## 0.1.0-alpha.6

### Patch Changes

- Updated dependencies []:
  - @cueloop/schema@0.1.0-alpha.6

## 0.1.0-alpha.5

### Patch Changes

- Updated dependencies []:
  - @cueloop/schema@0.1.0-alpha.5

## 0.1.0-alpha.4

### Patch Changes

- Updated dependencies []:
  - @cueloop/schema@0.1.0-alpha.4

## 0.1.0-alpha.3

### Patch Changes

- Updated dependencies []:
  - @cueloop/schema@0.1.0-alpha.3

## 0.1.0-alpha.2

### Patch Changes

- Updated dependencies []:
  - @cueloop/schema@0.1.0-alpha.2

## 0.1.0-alpha.1

### Patch Changes

- Updated dependencies []:
  - @cueloop/schema@0.1.0-alpha.1

## 0.1.0-alpha.0

### Patch Changes

- Updated dependencies []:
  - @cueloop/schema@0.1.0-alpha.0
