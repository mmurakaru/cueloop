# @cueloop/client

## 0.1.0-alpha.65

### Minor Changes

- [#326](https://github.com/mmurakaru/cueloop/pull/326) [`a9de22e`](https://github.com/mmurakaru/cueloop/commit/a9de22e9680fa4ba7e79e3b86815ec49ea6a01e6) Thanks [@mmurakaru](https://github.com/mmurakaru)! - The thread view is the plan surface.

  - Plans and replies open in the thread view; the plan sheet is retired and the opt-in flag is gone.
  - Session primitives move to chords: ctrl+enter submits, ctrl+e edits in `$EDITOR`, ctrl+s shares, ctrl+r cycles the rail.
  - Option plus a letter drives the rail and curation: cards (n / p), edit (e), delete (backspace), rename (r), cut (x), restore (u), resize (w / s).
  - Tracked changes render as before: cut blocks dim and struck through, added or edited blocks tagged; code blocks show their language; list items stay tight.
  - The keybinds dialog folds into two columns when the grammar outgrows the terminal.

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

- [#334](https://github.com/mmurakaru/cueloop/pull/334) [`3ee474c`](https://github.com/mmurakaru/cueloop/commit/3ee474cb4772b8a227686e32a960c1587e0f5c27) Thanks [@mmurakaru](https://github.com/mmurakaru)! - The rail has a Tree tab that shows the session's history: revisions, comments, checkpoints, and branches, with the path you are on bright and the current tip marked. Option chords and the buttons under it label a checkpoint, start a branch, go to an entry (a switch or a move back with an optional summary), fork the path, and fork-and-share. The thread view shows a moved path in the frame after the key.
- Updated dependencies [[`d4bfddc`](https://github.com/mmurakaru/cueloop/commit/d4bfddc0057c131c82c46258bc1921e11302e7ad), [`1b8253c`](https://github.com/mmurakaru/cueloop/commit/1b8253c0f2159e99244e1fdae9a3350eabb68055), [`6c5fdab`](https://github.com/mmurakaru/cueloop/commit/6c5fdab8ba7098344a051e5a0ef779af783c1249), [`3199a76`](https://github.com/mmurakaru/cueloop/commit/3199a76ec6af4fd6cc8c38a451522224c11229ea), [`3adc09e`](https://github.com/mmurakaru/cueloop/commit/3adc09e5294ef384872c1a8e578231c65ce76ce4), [`dcbd48d`](https://github.com/mmurakaru/cueloop/commit/dcbd48d2325e74230b7911038b0c51a0a2e3449b), [`8e56045`](https://github.com/mmurakaru/cueloop/commit/8e56045b6081a851a757cf33b676382c04c07446)]:
  - @cueloop/daemon@0.1.0-alpha.65
  - @cueloop/schema@0.1.0-alpha.65
  - @cueloop/extension-api@0.1.0-alpha.65
  - @cueloop/integration-obsidian@0.1.0-alpha.65

## 0.1.0-alpha.64

### Patch Changes

- [#304](https://github.com/mmurakaru/cueloop/pull/304) [`49feedc`](https://github.com/mmurakaru/cueloop/commit/49feedc74de12b677a13455b18c223743d125691) Thanks [@mmurakaru](https://github.com/mmurakaru)! - Parse untrusted JSON (persisted state, registry documents, external configs) with schemas at every I/O boundary, and enforce the new type-evidence lint rules across the workspace.
- Updated dependencies [[`49feedc`](https://github.com/mmurakaru/cueloop/commit/49feedc74de12b677a13455b18c223743d125691)]:
  - @cueloop/daemon@0.1.0-alpha.64
  - @cueloop/integration-obsidian@0.1.0-alpha.64
  - @cueloop/extension-api@0.1.0-alpha.64
  - @cueloop/schema@0.1.0-alpha.64

## 0.1.0-alpha.63

### Patch Changes

- [#299](https://github.com/mmurakaru/cueloop/pull/299) [`3fbe5e8`](https://github.com/mmurakaru/cueloop/commit/3fbe5e8e9d466a72e17bce743ab72f049513dc3e) Thanks [@mmurakaru](https://github.com/mmurakaru)! - Prototype review anchors clicks on focusable controls before falling back to component containers.
- Updated dependencies [[`17d2789`](https://github.com/mmurakaru/cueloop/commit/17d278988d2c65f7e1e5e635fc103c5de79f961a)]:
  - @cueloop/schema@0.1.0-alpha.63
  - @cueloop/daemon@0.1.0-alpha.63
  - @cueloop/extension-api@0.1.0-alpha.63
  - @cueloop/integration-obsidian@0.1.0-alpha.63

## 0.1.0-alpha.62

### Minor Changes

- Review surface refresh, all on the transparent theme:

  - The comment composer opens inline under the line you are commenting on in
    both the plan and diff views (the bottom `ComposeBar` is gone), and paints no
    background - a bordered frame floats over the visible session.
  - The plan and diff bodies now sit in a bordered frame whose border takes the
    document text colour. The header collapses to one flat inline row
    (`cueloop · title · rev · submitted by …`) with **Edit** and **Share** pinned
    to the plan sheet's top-right corner.
  - The rail's Review/Agent tabs are a full-width rounded box with no fill; the
    active tab reads in the accent. The resize divider is invisible (the plan's
    right border is the seam) but still drag-resizes. The empty state centres in
    the rail, and the rail body aligns under the tab labels.
  - Your own annotations tag as `me` in the accent once a collaborator has also
    left a note; collaborator notes keep their blue name-in-border card.
  - Share now surfaces the ssh link as a centred, auto-dismissing toast (a new
    `Toast` primitive) instead of an inline status line. The submit-review card is
    transparent like the other dialogs.
  - Replace the always-on keybind bar with a bottom-left menu that drops up to a
    keybinds cheatsheet and a settings dialog (auto-close and review panel,
    persisted), and show the cueloop version at the bottom-right under the rail.
  - Put "Submit review" inline with the rail's collapse chevron on the plan's
    bottom-border row and drop the trailing return glyph.
  - Annotation cards share the tab box's width and stack tightly; the keybinds and
    settings dialogs get a solid dark panel so their content stays legible.
  - Drop the `⏎` return glyph from every button and hint - the return key reads as
    the word "enter" where a key needs naming, and buttons show their label alone.

- The default theme no longer paints the canvas or flat chrome: `bg` and
  `panel` default to `transparent`, so the terminal's own background (and any
  transparency or blur it renders) shows through. Floating surfaces (dialogs,
  walk cards) now sit on the `elevated` token and stay opaque. Set `[theme]`
  `bg`/`panel` overrides in the user config for an opaque look.

- Dialogs no longer paint a dim backdrop or a surface fill - an open dialog
  floats as a bordered frame and the session stays visible behind it. Set
  `[theme] backdrop` to a colour to restore the dimmed layer.

  Theme tokens now use full names, and `[theme]` config keys follow suit:
  `bg` is `background`, `cursorBg` is `cursorBackground`, `markCommentBg` is
  `markCommentBackground`, `markSuggestionBg` is `markSuggestionBackground`,
  `insFg` is `insertedForeground`, `delFg` is `deletedForeground`. Update any
  overrides using the old keys.

### Patch Changes

- Enforce a cyclomatic complexity limit of 20 (oxlint) and refactor the functions that exceeded it - the intent dispatcher, keymap reducer, config layering, App, plan-sheet run-style, the CLI command routers, and the daemon dispatch - into small, table-driven units. Behavior and public APIs are unchanged.

- App test suites isolate the user config: a shared test helper points the
  config path into the test home, so local runs no longer read the
  developer's real config (a persisted review_state made char-frame tests
  time out locally while CI passed).
- Updated dependencies []:
  - @cueloop/schema@0.1.0-alpha.62
  - @cueloop/daemon@0.1.0-alpha.62
  - @cueloop/extension-api@0.1.0-alpha.62
  - @cueloop/integration-obsidian@0.1.0-alpha.62

## 0.1.0-alpha.61

### Minor Changes

- Review surface refresh, all on the transparent theme:

  - The comment composer opens inline under the line you are commenting on in
    both the plan and diff views (the bottom `ComposeBar` is gone), and paints no
    background - a bordered frame floats over the visible session.
  - The plan and diff bodies now sit in a bordered frame whose border takes the
    document text colour. The header collapses to one flat inline row
    (`cueloop · title · rev · submitted by …`) with **Edit** and **Share** pinned
    to the plan sheet's top-right corner.
  - The rail's Review/Agent tabs are a full-width rounded box with no fill; the
    active tab reads in the accent. The resize divider is invisible (the plan's
    right border is the seam) but still drag-resizes. The empty state centres in
    the rail, and the rail body aligns under the tab labels.
  - Your own annotations tag as `me` in the accent once a collaborator has also
    left a note; collaborator notes keep their blue name-in-border card.
  - Share now surfaces the ssh link as a centred, auto-dismissing toast (a new
    `Toast` primitive) instead of an inline status line. The submit-review card is
    transparent like the other dialogs.
  - Replace the always-on keybind bar with a bottom-left menu that drops up to a
    keybinds cheatsheet and a settings dialog (auto-close and review panel,
    persisted), and show the cueloop version at the bottom-right under the rail.
  - Put "Submit review" inline with the rail's collapse chevron on the plan's
    bottom-border row and drop the trailing return glyph.
  - Annotation cards share the tab box's width and stack tightly; the keybinds and
    settings dialogs get a solid dark panel so their content stays legible.
  - Drop the `⏎` return glyph from every button and hint - the return key reads as
    the word "enter" where a key needs naming, and buttons show their label alone.

- The default theme no longer paints the canvas or flat chrome: `bg` and
  `panel` default to `transparent`, so the terminal's own background (and any
  transparency or blur it renders) shows through. Floating surfaces (dialogs,
  walk cards) now sit on the `elevated` token and stay opaque. Set `[theme]`
  `bg`/`panel` overrides in the user config for an opaque look.

- Dialogs no longer paint a dim backdrop or a surface fill - an open dialog
  floats as a bordered frame and the session stays visible behind it. Set
  `[theme] backdrop` to a colour to restore the dimmed layer.

  Theme tokens now use full names, and `[theme]` config keys follow suit:
  `bg` is `background`, `cursorBg` is `cursorBackground`, `markCommentBg` is
  `markCommentBackground`, `markSuggestionBg` is `markSuggestionBackground`,
  `insFg` is `insertedForeground`, `delFg` is `deletedForeground`. Update any
  overrides using the old keys.

### Patch Changes

- Enforce a cyclomatic complexity limit of 20 (oxlint) and refactor the functions that exceeded it - the intent dispatcher, keymap reducer, config layering, App, plan-sheet run-style, the CLI command routers, and the daemon dispatch - into small, table-driven units. Behavior and public APIs are unchanged.

- App test suites isolate the user config: a shared test helper points the
  config path into the test home, so local runs no longer read the
  developer's real config (a persisted review_state made char-frame tests
  time out locally while CI passed).
- Updated dependencies []:
  - @cueloop/schema@0.1.0-alpha.61
  - @cueloop/daemon@0.1.0-alpha.61
  - @cueloop/extension-api@0.1.0-alpha.61
  - @cueloop/integration-obsidian@0.1.0-alpha.61

## 0.1.0-alpha.60

### Patch Changes

- Updated dependencies []:
  - @cueloop/daemon@0.1.0-alpha.60
  - @cueloop/extension-api@0.1.0-alpha.60
  - @cueloop/integration-obsidian@0.1.0-alpha.60
  - @cueloop/schema@0.1.0-alpha.60

## 0.1.0-alpha.59

### Patch Changes

- [#278](https://github.com/mmurakaru/cueloop/pull/278) [`8523940`](https://github.com/mmurakaru/cueloop/commit/852394000ba356c159b21097e46cf8036a6ebf21) Thanks [@mmurakaru](https://github.com/mmurakaru)! - Enforce a cyclomatic complexity limit of 20 (oxlint) and refactor the functions that exceeded it - the intent dispatcher, keymap reducer, config layering, App, plan-sheet run-style, the CLI command routers, and the daemon dispatch - into small, table-driven units. Behavior and public APIs are unchanged.

- Updated dependencies [[`8523940`](https://github.com/mmurakaru/cueloop/commit/852394000ba356c159b21097e46cf8036a6ebf21)]:
  - @cueloop/daemon@0.1.0-alpha.59
  - @cueloop/extension-api@0.1.0-alpha.59
  - @cueloop/integration-obsidian@0.1.0-alpha.59
  - @cueloop/schema@0.1.0-alpha.59

## 0.1.0-alpha.58

### Patch Changes

- Updated dependencies []:
  - @cueloop/daemon@0.1.0-alpha.58
  - @cueloop/extension-api@0.1.0-alpha.58
  - @cueloop/integration-obsidian@0.1.0-alpha.58
  - @cueloop/schema@0.1.0-alpha.58

## 0.1.0-alpha.57

### Patch Changes

- Updated dependencies []:
  - @cueloop/daemon@0.1.0-alpha.57
  - @cueloop/extension-api@0.1.0-alpha.57
  - @cueloop/integration-obsidian@0.1.0-alpha.57
  - @cueloop/schema@0.1.0-alpha.57

## 0.1.0-alpha.56

### Patch Changes

- Updated dependencies []:
  - @cueloop/daemon@0.1.0-alpha.56
  - @cueloop/extension-api@0.1.0-alpha.56
  - @cueloop/integration-obsidian@0.1.0-alpha.56
  - @cueloop/schema@0.1.0-alpha.56

## 0.1.0-alpha.55

### Patch Changes

- Updated dependencies []:
  - @cueloop/daemon@0.1.0-alpha.55
  - @cueloop/extension-api@0.1.0-alpha.55
  - @cueloop/integration-obsidian@0.1.0-alpha.55
  - @cueloop/schema@0.1.0-alpha.55

## 0.1.0-alpha.54

### Patch Changes

- Updated dependencies []:
  - @cueloop/daemon@0.1.0-alpha.54
  - @cueloop/extension-api@0.1.0-alpha.54
  - @cueloop/integration-obsidian@0.1.0-alpha.54
  - @cueloop/schema@0.1.0-alpha.54

## 0.1.0-alpha.53

### Patch Changes

- Updated dependencies []:
  - @cueloop/daemon@0.1.0-alpha.53
  - @cueloop/extension-api@0.1.0-alpha.53
  - @cueloop/integration-obsidian@0.1.0-alpha.53
  - @cueloop/schema@0.1.0-alpha.53

## 0.1.0-alpha.52

### Patch Changes

- Updated dependencies []:
  - @cueloop/daemon@0.1.0-alpha.52
  - @cueloop/extension-api@0.1.0-alpha.52
  - @cueloop/integration-obsidian@0.1.0-alpha.52
  - @cueloop/schema@0.1.0-alpha.52

## 0.1.0-alpha.51

### Patch Changes

- Updated dependencies []:
  - @cueloop/daemon@0.1.0-alpha.51
  - @cueloop/extension-api@0.1.0-alpha.51
  - @cueloop/integration-obsidian@0.1.0-alpha.51
  - @cueloop/schema@0.1.0-alpha.51

## 0.1.0-alpha.50

### Patch Changes

- Updated dependencies []:
  - @cueloop/daemon@0.1.0-alpha.50
  - @cueloop/extension-api@0.1.0-alpha.50
  - @cueloop/integration-obsidian@0.1.0-alpha.50
  - @cueloop/schema@0.1.0-alpha.50

## 0.1.0-alpha.49

### Patch Changes

- Updated dependencies []:
  - @cueloop/daemon@0.1.0-alpha.49
  - @cueloop/extension-api@0.1.0-alpha.49
  - @cueloop/integration-obsidian@0.1.0-alpha.49
  - @cueloop/schema@0.1.0-alpha.49

## 0.1.0-alpha.48

### Patch Changes

- Updated dependencies []:
  - @cueloop/daemon@0.1.0-alpha.48
  - @cueloop/extension-api@0.1.0-alpha.48
  - @cueloop/integration-obsidian@0.1.0-alpha.48
  - @cueloop/schema@0.1.0-alpha.48

## 0.1.0-alpha.47

### Patch Changes

- Updated dependencies []:
  - @cueloop/daemon@0.1.0-alpha.47
  - @cueloop/extension-api@0.1.0-alpha.47
  - @cueloop/integration-obsidian@0.1.0-alpha.47
  - @cueloop/schema@0.1.0-alpha.47

## 0.1.0-alpha.46

### Patch Changes

- Updated dependencies []:
  - @cueloop/daemon@0.1.0-alpha.46
  - @cueloop/extension-api@0.1.0-alpha.46
  - @cueloop/integration-obsidian@0.1.0-alpha.46
  - @cueloop/schema@0.1.0-alpha.46

## 0.1.0-alpha.45

### Patch Changes

- Updated dependencies []:
  - @cueloop/daemon@0.1.0-alpha.45
  - @cueloop/extension-api@0.1.0-alpha.45
  - @cueloop/integration-obsidian@0.1.0-alpha.45
  - @cueloop/schema@0.1.0-alpha.45

## 0.1.0-alpha.44

### Patch Changes

- Updated dependencies []:
  - @cueloop/daemon@0.1.0-alpha.44
  - @cueloop/extension-api@0.1.0-alpha.44
  - @cueloop/integration-obsidian@0.1.0-alpha.44
  - @cueloop/schema@0.1.0-alpha.44

## 0.1.0-alpha.43

### Patch Changes

- Updated dependencies []:
  - @cueloop/daemon@0.1.0-alpha.43
  - @cueloop/extension-api@0.1.0-alpha.43
  - @cueloop/integration-obsidian@0.1.0-alpha.43
  - @cueloop/schema@0.1.0-alpha.43

## 0.1.0-alpha.42

### Patch Changes

- Updated dependencies []:
  - @cueloop/daemon@0.1.0-alpha.42
  - @cueloop/extension-api@0.1.0-alpha.42
  - @cueloop/integration-obsidian@0.1.0-alpha.42
  - @cueloop/schema@0.1.0-alpha.42

## 0.1.0-alpha.41

### Patch Changes

- Updated dependencies []:
  - @cueloop/daemon@0.1.0-alpha.41
  - @cueloop/extension-api@0.1.0-alpha.41
  - @cueloop/integration-obsidian@0.1.0-alpha.41
  - @cueloop/schema@0.1.0-alpha.41

## 0.1.0-alpha.40

### Patch Changes

- Updated dependencies []:
  - @cueloop/daemon@0.1.0-alpha.40
  - @cueloop/extension-api@0.1.0-alpha.40
  - @cueloop/integration-obsidian@0.1.0-alpha.40
  - @cueloop/schema@0.1.0-alpha.40

## 0.1.0-alpha.39

### Patch Changes

- Updated dependencies []:
  - @cueloop/daemon@0.1.0-alpha.39
  - @cueloop/extension-api@0.1.0-alpha.39
  - @cueloop/integration-obsidian@0.1.0-alpha.39
  - @cueloop/schema@0.1.0-alpha.39

## 0.1.0-alpha.38

### Patch Changes

- Updated dependencies []:
  - @cueloop/daemon@0.1.0-alpha.38
  - @cueloop/extension-api@0.1.0-alpha.38
  - @cueloop/integration-obsidian@0.1.0-alpha.38
  - @cueloop/schema@0.1.0-alpha.38

## 0.1.0-alpha.37

### Patch Changes

- Updated dependencies []:
  - @cueloop/daemon@0.1.0-alpha.37
  - @cueloop/extension-api@0.1.0-alpha.37
  - @cueloop/integration-obsidian@0.1.0-alpha.37
  - @cueloop/schema@0.1.0-alpha.37

## 0.1.0-alpha.36

### Patch Changes

- Updated dependencies []:
  - @cueloop/daemon@0.1.0-alpha.36
  - @cueloop/extension-api@0.1.0-alpha.36
  - @cueloop/integration-obsidian@0.1.0-alpha.36
  - @cueloop/schema@0.1.0-alpha.36

## 0.1.0-alpha.35

### Patch Changes

- Updated dependencies []:
  - @cueloop/daemon@0.1.0-alpha.35
  - @cueloop/extension-api@0.1.0-alpha.35
  - @cueloop/integration-obsidian@0.1.0-alpha.35
  - @cueloop/schema@0.1.0-alpha.35

## 0.1.0-alpha.34

### Patch Changes

- Updated dependencies [[`8d8abab`](https://github.com/mmurakaru/cueloop/commit/8d8ababc2c44b3a7352f18c7341af01d23f6042a), [`b241ac8`](https://github.com/mmurakaru/cueloop/commit/b241ac8398871f67a141e909ad72292a8245cadd), [`d5ef124`](https://github.com/mmurakaru/cueloop/commit/d5ef124532a4e5137cc0a6ca8a1bf7b8dee840e1)]:
  - @cueloop/schema@0.1.0-alpha.34
  - @cueloop/daemon@0.1.0-alpha.34
  - @cueloop/extension-api@0.1.0-alpha.34
  - @cueloop/integration-obsidian@0.1.0-alpha.34

## 0.1.0-alpha.33

### Minor Changes

- [#185](https://github.com/mmurakaru/cueloop/pull/185) [`c1f3ab2`](https://github.com/mmurakaru/cueloop/commit/c1f3ab2b22ceed5ff2b157b42f5c5df9b1ff6845) Thanks [@mmurakaru](https://github.com/mmurakaru)! - Review surface refresh, all on the transparent theme:

  - The comment composer opens inline under the line you are commenting on in
    both the plan and diff views (the bottom `ComposeBar` is gone), and paints no
    background - a bordered frame floats over the visible session.
  - The plan and diff bodies now sit in a bordered frame whose border takes the
    document text colour. The header collapses to one flat inline row
    (`cueloop · title · rev · submitted by …`) with **Edit** and **Share** pinned
    to the plan sheet's top-right corner.
  - The rail's Review/Agent tabs are a full-width rounded box with no fill; the
    active tab reads in the accent. The resize divider is invisible (the plan's
    right border is the seam) but still drag-resizes. The empty state centres in
    the rail, and the rail body aligns under the tab labels.
  - Your own annotations tag as `me` in the accent once a collaborator has also
    left a note; collaborator notes keep their blue name-in-border card.
  - Share now surfaces the ssh link as a centred, auto-dismissing toast (a new
    `Toast` primitive) instead of an inline status line. The submit-review card is
    transparent like the other dialogs.
  - Replace the always-on keybind bar with a bottom-left menu that drops up to a
    keybinds cheatsheet and a settings dialog (auto-close and review panel,
    persisted), and show the cueloop version at the bottom-right under the rail.
  - Put "Submit review" inline with the rail's collapse chevron on the plan's
    bottom-border row and drop the trailing return glyph.
  - Annotation cards share the tab box's width and stack tightly; the keybinds and
    settings dialogs get a solid dark panel so their content stays legible.
  - Drop the `⏎` return glyph from every button and hint - the return key reads as
    the word "enter" where a key needs naming, and buttons show their label alone.

### Patch Changes

- Updated dependencies []:
  - @cueloop/daemon@0.1.0-alpha.33
  - @cueloop/extension-api@0.1.0-alpha.33
  - @cueloop/integration-obsidian@0.1.0-alpha.33
  - @cueloop/schema@0.1.0-alpha.33

## 0.1.0-alpha.32

### Minor Changes

- [#182](https://github.com/mmurakaru/cueloop/pull/182) [`010b7a9`](https://github.com/mmurakaru/cueloop/commit/010b7a9837e0263a4779729d492ba0fd51eba8db) Thanks [@mmurakaru](https://github.com/mmurakaru)! - Dialogs no longer paint a dim backdrop or a surface fill - an open dialog
  floats as a bordered frame and the session stays visible behind it. Set
  `[theme] backdrop` to a colour to restore the dimmed layer.

  Theme tokens now use full names, and `[theme]` config keys follow suit:
  `bg` is `background`, `cursorBg` is `cursorBackground`, `markCommentBg` is
  `markCommentBackground`, `markSuggestionBg` is `markSuggestionBackground`,
  `insFg` is `insertedForeground`, `delFg` is `deletedForeground`. Update any
  overrides using the old keys.

### Patch Changes

- [#182](https://github.com/mmurakaru/cueloop/pull/182) [`010b7a9`](https://github.com/mmurakaru/cueloop/commit/010b7a9837e0263a4779729d492ba0fd51eba8db) Thanks [@mmurakaru](https://github.com/mmurakaru)! - App test suites isolate the user config: a shared test helper points the
  config path into the test home, so local runs no longer read the
  developer's real config (a persisted review_state made char-frame tests
  time out locally while CI passed).
- Updated dependencies []:
  - @cueloop/daemon@0.1.0-alpha.32
  - @cueloop/extension-api@0.1.0-alpha.32
  - @cueloop/integration-obsidian@0.1.0-alpha.32
  - @cueloop/schema@0.1.0-alpha.32

## 0.1.0-alpha.31

### Minor Changes

- [#180](https://github.com/mmurakaru/cueloop/pull/180) [`3cfa5e0`](https://github.com/mmurakaru/cueloop/commit/3cfa5e065d897b3f27f3fe81f7e999e52731f24a) Thanks [@mmurakaru](https://github.com/mmurakaru)! - The default theme no longer paints the canvas or flat chrome: `bg` and
  `panel` default to `transparent`, so the terminal's own background (and any
  transparency or blur it renders) shows through. Floating surfaces (dialogs,
  walk cards) now sit on the `elevated` token and stay opaque. Set `[theme]`
  `bg`/`panel` overrides in the user config for an opaque look.

### Patch Changes

- Updated dependencies []:
  - @cueloop/daemon@0.1.0-alpha.31
  - @cueloop/extension-api@0.1.0-alpha.31
  - @cueloop/integration-obsidian@0.1.0-alpha.31
  - @cueloop/schema@0.1.0-alpha.31

## 0.1.0-alpha.30

### Patch Changes

- Updated dependencies []:
  - @cueloop/daemon@0.1.0-alpha.30
  - @cueloop/extension-api@0.1.0-alpha.30
  - @cueloop/integration-obsidian@0.1.0-alpha.30
  - @cueloop/schema@0.1.0-alpha.30

## 0.1.0-alpha.29

### Patch Changes

- Updated dependencies []:
  - @cueloop/daemon@0.1.0-alpha.29
  - @cueloop/extension-api@0.1.0-alpha.29
  - @cueloop/integration-obsidian@0.1.0-alpha.29
  - @cueloop/schema@0.1.0-alpha.29

## 0.1.0-alpha.28

### Patch Changes

- Updated dependencies []:
  - @cueloop/daemon@0.1.0-alpha.28
  - @cueloop/extension-api@0.1.0-alpha.28
  - @cueloop/integration-obsidian@0.1.0-alpha.28
  - @cueloop/schema@0.1.0-alpha.28

## 0.1.0-alpha.27

### Patch Changes

- Updated dependencies []:
  - @cueloop/daemon@0.1.0-alpha.27
  - @cueloop/extension-api@0.1.0-alpha.27
  - @cueloop/integration-obsidian@0.1.0-alpha.27
  - @cueloop/schema@0.1.0-alpha.27

## 0.1.0-alpha.26

### Patch Changes

- Updated dependencies []:
  - @cueloop/daemon@0.1.0-alpha.26
  - @cueloop/extension-api@0.1.0-alpha.26
  - @cueloop/integration-obsidian@0.1.0-alpha.26
  - @cueloop/schema@0.1.0-alpha.26

## 0.1.0-alpha.25

### Patch Changes

- Updated dependencies []:
  - @cueloop/daemon@0.1.0-alpha.25
  - @cueloop/extension-api@0.1.0-alpha.25
  - @cueloop/integration-obsidian@0.1.0-alpha.25
  - @cueloop/schema@0.1.0-alpha.25

## 0.1.0-alpha.24

### Patch Changes

- Updated dependencies []:
  - @cueloop/daemon@0.1.0-alpha.24
  - @cueloop/extension-api@0.1.0-alpha.24
  - @cueloop/integration-obsidian@0.1.0-alpha.24
  - @cueloop/schema@0.1.0-alpha.24

## 0.1.0-alpha.23

### Patch Changes

- Updated dependencies []:
  - @cueloop/daemon@0.1.0-alpha.23
  - @cueloop/extension-api@0.1.0-alpha.23
  - @cueloop/integration-obsidian@0.1.0-alpha.23
  - @cueloop/schema@0.1.0-alpha.23

## 0.1.0-alpha.22

### Patch Changes

- Updated dependencies []:
  - @cueloop/daemon@0.1.0-alpha.22
  - @cueloop/extension-api@0.1.0-alpha.22
  - @cueloop/integration-obsidian@0.1.0-alpha.22
  - @cueloop/schema@0.1.0-alpha.22

## 0.1.0-alpha.21

### Patch Changes

- Updated dependencies []:
  - @cueloop/daemon@0.1.0-alpha.21
  - @cueloop/extension-api@0.1.0-alpha.21
  - @cueloop/integration-obsidian@0.1.0-alpha.21
  - @cueloop/schema@0.1.0-alpha.21

## 0.1.0-alpha.20

### Patch Changes

- Updated dependencies []:
  - @cueloop/daemon@0.1.0-alpha.20
  - @cueloop/extension-api@0.1.0-alpha.20
  - @cueloop/integration-obsidian@0.1.0-alpha.20
  - @cueloop/schema@0.1.0-alpha.20

## 0.1.0-alpha.19

### Patch Changes

- Updated dependencies []:
  - @cueloop/daemon@0.1.0-alpha.19
  - @cueloop/extension-api@0.1.0-alpha.19
  - @cueloop/integration-obsidian@0.1.0-alpha.19
  - @cueloop/schema@0.1.0-alpha.19

## 0.1.0-alpha.18

### Patch Changes

- Updated dependencies []:
  - @cueloop/daemon@0.1.0-alpha.18
  - @cueloop/extension-api@0.1.0-alpha.18
  - @cueloop/integration-obsidian@0.1.0-alpha.18
  - @cueloop/schema@0.1.0-alpha.18

## 0.1.0-alpha.17

### Patch Changes

- Updated dependencies []:
  - @cueloop/daemon@0.1.0-alpha.17
  - @cueloop/extension-api@0.1.0-alpha.17
  - @cueloop/integration-obsidian@0.1.0-alpha.17
  - @cueloop/schema@0.1.0-alpha.17

## 0.1.0-alpha.16

### Patch Changes

- Updated dependencies []:
  - @cueloop/daemon@0.1.0-alpha.16
  - @cueloop/extension-api@0.1.0-alpha.16
  - @cueloop/integration-obsidian@0.1.0-alpha.16
  - @cueloop/schema@0.1.0-alpha.16

## 0.1.0-alpha.15

### Patch Changes

- Updated dependencies []:
  - @cueloop/daemon@0.1.0-alpha.15
  - @cueloop/extension-api@0.1.0-alpha.15
  - @cueloop/integration-obsidian@0.1.0-alpha.15
  - @cueloop/schema@0.1.0-alpha.15

## 0.1.0-alpha.14

### Patch Changes

- Updated dependencies []:
  - @cueloop/daemon@0.1.0-alpha.14
  - @cueloop/extension-api@0.1.0-alpha.14
  - @cueloop/integration-obsidian@0.1.0-alpha.14
  - @cueloop/schema@0.1.0-alpha.14

## 0.1.0-alpha.13

### Patch Changes

- Updated dependencies []:
  - @cueloop/daemon@0.1.0-alpha.13
  - @cueloop/extension-api@0.1.0-alpha.13
  - @cueloop/integration-obsidian@0.1.0-alpha.13
  - @cueloop/schema@0.1.0-alpha.13

## 0.1.0-alpha.12

### Patch Changes

- Updated dependencies []:
  - @cueloop/daemon@0.1.0-alpha.12
  - @cueloop/extension-api@0.1.0-alpha.12
  - @cueloop/integration-obsidian@0.1.0-alpha.12
  - @cueloop/schema@0.1.0-alpha.12

## 0.1.0-alpha.11

### Patch Changes

- Updated dependencies []:
  - @cueloop/daemon@0.1.0-alpha.11
  - @cueloop/extension-api@0.1.0-alpha.11
  - @cueloop/integration-obsidian@0.1.0-alpha.11
  - @cueloop/schema@0.1.0-alpha.11

## 0.1.0-alpha.10

### Patch Changes

- Updated dependencies []:
  - @cueloop/daemon@0.1.0-alpha.10
  - @cueloop/extension-api@0.1.0-alpha.10
  - @cueloop/integration-obsidian@0.1.0-alpha.10
  - @cueloop/schema@0.1.0-alpha.10

## 0.1.0-alpha.9

### Patch Changes

- Updated dependencies []:
  - @cueloop/daemon@0.1.0-alpha.9
  - @cueloop/extension-api@0.1.0-alpha.9
  - @cueloop/integration-obsidian@0.1.0-alpha.9
  - @cueloop/schema@0.1.0-alpha.9

## 0.1.0-alpha.8

### Patch Changes

- Updated dependencies []:
  - @cueloop/daemon@0.1.0-alpha.8
  - @cueloop/extension-api@0.1.0-alpha.8
  - @cueloop/integration-obsidian@0.1.0-alpha.8
  - @cueloop/schema@0.1.0-alpha.8

## 0.1.0-alpha.7

### Patch Changes

- Updated dependencies []:
  - @cueloop/daemon@0.1.0-alpha.7
  - @cueloop/extension-api@0.1.0-alpha.7
  - @cueloop/integration-obsidian@0.1.0-alpha.7
  - @cueloop/schema@0.1.0-alpha.7

## 0.1.0-alpha.6

### Patch Changes

- Updated dependencies []:
  - @cueloop/daemon@0.1.0-alpha.6
  - @cueloop/extension-api@0.1.0-alpha.6
  - @cueloop/integration-obsidian@0.1.0-alpha.6
  - @cueloop/schema@0.1.0-alpha.6

## 0.1.0-alpha.5

### Patch Changes

- Updated dependencies []:
  - @cueloop/daemon@0.1.0-alpha.5
  - @cueloop/extension-api@0.1.0-alpha.5
  - @cueloop/integration-obsidian@0.1.0-alpha.5
  - @cueloop/schema@0.1.0-alpha.5

## 0.1.0-alpha.4

### Patch Changes

- Updated dependencies []:
  - @cueloop/daemon@0.1.0-alpha.4
  - @cueloop/extension-api@0.1.0-alpha.4
  - @cueloop/integration-obsidian@0.1.0-alpha.4
  - @cueloop/schema@0.1.0-alpha.4

## 0.1.0-alpha.3

### Patch Changes

- Updated dependencies []:
  - @cueloop/daemon@0.1.0-alpha.3
  - @cueloop/extension-api@0.1.0-alpha.3
  - @cueloop/integration-obsidian@0.1.0-alpha.3
  - @cueloop/schema@0.1.0-alpha.3

## 0.1.0-alpha.2

### Patch Changes

- Updated dependencies []:
  - @cueloop/daemon@0.1.0-alpha.2
  - @cueloop/extension-api@0.1.0-alpha.2
  - @cueloop/integration-obsidian@0.1.0-alpha.2
  - @cueloop/schema@0.1.0-alpha.2

## 0.1.0-alpha.1

### Patch Changes

- Updated dependencies []:
  - @cueloop/daemon@0.1.0-alpha.1
  - @cueloop/extension-api@0.1.0-alpha.1
  - @cueloop/integration-obsidian@0.1.0-alpha.1
  - @cueloop/schema@0.1.0-alpha.1

## 0.1.0-alpha.0

### Patch Changes

- Updated dependencies []:
  - @cueloop/daemon@0.1.0-alpha.0
  - @cueloop/extension-api@0.1.0-alpha.0
  - @cueloop/integration-obsidian@0.1.0-alpha.0
  - @cueloop/schema@0.1.0-alpha.0
