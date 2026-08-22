# @cueloop/client

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
