# cueloop

## 0.1.0-alpha.53

### Patch Changes

- [#258](https://github.com/mmurakaru/cueloop/pull/258) [`f0165b2`](https://github.com/mmurakaru/cueloop/commit/f0165b222395a851d026b19ea2607308c7172893) Thanks [@mmurakaru](https://github.com/mmurakaru)! - Make the prototype review surface fast and align its comment composer with plan mode. The screenshot is transmitted under one fixed kitty placement id so each frame replaces that placement instead of stacking a new one (the growing lag/ghosting on interaction); selecting an element no longer re-screenshots the page through Chromium (the popover is the selection feedback, as in plan mode); the divider drag only re-renders when the rail width actually changes a column; the headless Chromium is kept warm and reused across opens instead of cold-starting each time; the page load waits for `load` rather than `networkidle0`'s fixed idle window; the capture is sized to the region's real pixels; and an opt-in out-of-band file transfer (`CUELOOP_KITTY_FILE=1`, local only) sends the PNG as a temp-file path instead of base64 through the pty. The prototype composer now cancels on escape, matching the plan composer.

- Updated dependencies []:
  - @cueloop/adapters@0.1.0-alpha.53
  - @cueloop/client@0.1.0-alpha.53
  - @cueloop/daemon@0.1.0-alpha.53
  - @cueloop/schema@0.1.0-alpha.53

## 0.1.0-alpha.52

### Patch Changes

- [#231](https://github.com/mmurakaru/cueloop/pull/231) [`d08e286`](https://github.com/mmurakaru/cueloop/commit/d08e286d823a85bb61325337518d7f0d319b0819) Thanks [@dependabot](https://github.com/apps/dependabot)! - Bump `diff` from 8.0.4 to 9.0.0. The client's intraline word-diff (`diffWordsWithSpace`) is unchanged and its tests plus the full suite pass; this also aligns the direct dependency with the `diff@9` that `@opentui/core` already resolves.

- [#230](https://github.com/mmurakaru/cueloop/pull/230) [`853e7ce`](https://github.com/mmurakaru/cueloop/commit/853e7ce0a0028d3bc85f6efd0e1f2f2f32fe4777) Thanks [@dependabot](https://github.com/apps/dependabot)! - Bump the `@opentui/*` group (core, react, keymap, ssh) to 0.5.8, aligned across the client and gateway. Keeping the whole group on one version collapses to a single `@opentui/core`, avoiding a dual-renderer install. Typecheck, the full test suite, and all render snapshots pass unchanged.

- Updated dependencies []:
  - @cueloop/adapters@0.1.0-alpha.52
  - @cueloop/client@0.1.0-alpha.52
  - @cueloop/daemon@0.1.0-alpha.52
  - @cueloop/schema@0.1.0-alpha.52

## 0.1.0-alpha.51

### Patch Changes

- [#255](https://github.com/mmurakaru/cueloop/pull/255) [`f9f1acb`](https://github.com/mmurakaru/cueloop/commit/f9f1acb03cf22268a2a1cbf9c7d3b34338a44375) Thanks [@mmurakaru](https://github.com/mmurakaru)! - Harden refine's persisted state and skip-seen. `refine-state.json` and the `[cleanup] period_days` config value are now parsed with valibot instead of ad-hoc casts, so malformed state or a mistyped config value falls back cleanly. refine keys its skip-seen state on a per-session fingerprint (revision count, annotation count, resolved timestamp) rather than a bare id set, so a resolved session that is reopened and resolved again with new feedback is re-analyzed instead of being skipped forever.

- Updated dependencies []:
  - @cueloop/adapters@0.1.0-alpha.51
  - @cueloop/client@0.1.0-alpha.51
  - @cueloop/daemon@0.1.0-alpha.51
  - @cueloop/schema@0.1.0-alpha.51

## 0.1.0-alpha.50

### Minor Changes

- [#253](https://github.com/mmurakaru/cueloop/pull/253) [`bc73fa8`](https://github.com/mmurakaru/cueloop/commit/bc73fa83774d2a7ed59ee174c691e76c79e0184a) Thanks [@mmurakaru](https://github.com/mmurakaru)! - Add the `refine` primitive: `cueloop refine` reads the corpus of past review sessions and writes a Markdown report to `~/.cueloop/reports/` (latest `report.md` plus a timestamped copy). The report gives corpus stats, reviewer annotations grouped by kind with their session/primitive/verdict/week, and weekly volume; a run analyzes up to 200 unseen sessions and skips sessions with no annotation and no verdict. The `/cueloop:refine` skill drives the agent to group the annotations into named patterns and propose writebacks (to a skill, `AGENTS.md`, `CLAUDE.md`, or memory) for human approval via a plan review. Adds a `cleanupPeriodDays` retention window (default 30) read from `[cleanup] period_days`: the daemon prunes sessions past the window on startup, and `refine` prunes old reports.

### Patch Changes

- Updated dependencies []:
  - @cueloop/adapters@0.1.0-alpha.50
  - @cueloop/client@0.1.0-alpha.50
  - @cueloop/daemon@0.1.0-alpha.50
  - @cueloop/schema@0.1.0-alpha.50

## 0.1.0-alpha.49

### Patch Changes

- [`d029093`](https://github.com/mmurakaru/cueloop/commit/d02909301792e446d878cfaa823336a4795ee434) Thanks [@mmurakaru](https://github.com/mmurakaru)! - Prototype review action popovers now paint their standard opaque background over the rendered page instead of letting the page show through.

- Updated dependencies []:
  - @cueloop/adapters@0.1.0-alpha.49
  - @cueloop/client@0.1.0-alpha.49
  - @cueloop/daemon@0.1.0-alpha.49
  - @cueloop/schema@0.1.0-alpha.49

## 0.1.0-alpha.48

### Patch Changes

- [#249](https://github.com/mmurakaru/cueloop/pull/249) [`18d908e`](https://github.com/mmurakaru/cueloop/commit/18d908e1c5daa5c0c4736de89387a1cc21f398a4) Thanks [@mmurakaru](https://github.com/mmurakaru)! - Prototype review polish: the preview scrolls with the mouse wheel when the page overflows the box (the page scrolls and re-renders), the marker actions bar and compose card now sit on an opaque fill so they read as solid cards over the image, and the image is pulled while an app menu or settings overlay is open so those overlays no longer show through the graphics layer.

- Updated dependencies []:
  - @cueloop/adapters@0.1.0-alpha.48
  - @cueloop/client@0.1.0-alpha.48
  - @cueloop/daemon@0.1.0-alpha.48
  - @cueloop/schema@0.1.0-alpha.48

## 0.1.0-alpha.47

### Patch Changes

- [#248](https://github.com/mmurakaru/cueloop/pull/248) [`83e597b`](https://github.com/mmurakaru/cueloop/commit/83e597b47e7898e95e360b554ce13c440a98cf08) Thanks [@mmurakaru](https://github.com/mmurakaru)! - Prototype review now renders the page. The screenshot is painted directly through the kitty graphics protocol into a reserved cell region (transmit once, re-place after each frame, beneath the text layer) rather than OpenTUI's image renderable, which stayed blank in some terminals; the capture viewport matches the box's cell aspect so the image fills it. Typing a comment no longer leaks to the global keymap - the compose textarea owns the keyboard while open and Enter saves. Adds an end-to-end test covering click -> actions bar -> comment -> save -> rail.

- [#246](https://github.com/mmurakaru/cueloop/pull/246) [`e0c77be`](https://github.com/mmurakaru/cueloop/commit/e0c77be42ebdd3b1160d9c1be6a736da2b37c487) Thanks [@mmurakaru](https://github.com/mmurakaru)! - Advertise the prototype review skill in the plugin: `/cueloop:prototype` now appears in the plugin and marketplace descriptions alongside plan, diff, review, and annotate.

- Updated dependencies []:
  - @cueloop/adapters@0.1.0-alpha.47
  - @cueloop/client@0.1.0-alpha.47
  - @cueloop/daemon@0.1.0-alpha.47
  - @cueloop/schema@0.1.0-alpha.47

## 0.1.0-alpha.46

### Patch Changes

- [#244](https://github.com/mmurakaru/cueloop/pull/244) [`2d98a49`](https://github.com/mmurakaru/cueloop/commit/2d98a49188060e38baca5fcc9933bde99e739c06) Thanks [@mmurakaru](https://github.com/mmurakaru)! - Add prototype review: `cueloop prototype <file.html>` renders an HTML prototype with headless Chromium and shows it as an image in the review sheet. Click a rendered element - a design-system card, say - to select it (the click resolves to the nearest component element), and the marker actions bar and compose card annotate that element by CSS selector. The verdict feedback locates each comment by its selector. Needs a graphics-capable terminal (kitty or ghostty) and an installed Google Chrome; other terminals show a capability notice. A new `prototype` skill lets an agent submit a prototype for non-blocking review.

- Updated dependencies []:
  - @cueloop/adapters@0.1.0-alpha.46
  - @cueloop/client@0.1.0-alpha.46
  - @cueloop/daemon@0.1.0-alpha.46
  - @cueloop/schema@0.1.0-alpha.46

## 0.1.0-alpha.45

### Patch Changes

- [#242](https://github.com/mmurakaru/cueloop/pull/242) [`311633c`](https://github.com/mmurakaru/cueloop/commit/311633c003680f757ec32dee8e2945ecca8694fc) Thanks [@mmurakaru](https://github.com/mmurakaru)! - Render inline Markdown in the review surface. Prose now shows real emphasis - **strong**, _emphasis_, `code`, ~~strikethrough~~, and [links](url) - with the markup markers concealed, blockquotes muted, and headings bold with the level (h1/h2/h3) shown by descending brightness (a terminal cannot scale font size), leaving the salmon accent to annotations. Links become clickable OSC 8 terminal hyperlinks (http(s)/mailto only). The styling is produced by a new pure inline tokenizer in `@cueloop/schema` that emits each visible span at its exact source offset and drops the markers, so quote anchors, mouse selection, and keyboard-span selection stay character-precise - annotations resolve against the same text as before, and emphasis composes with word-diff on edited blocks.

- [#242](https://github.com/mmurakaru/cueloop/pull/242) [`311633c`](https://github.com/mmurakaru/cueloop/commit/311633c003680f757ec32dee8e2945ecca8694fc) Thanks [@mmurakaru](https://github.com/mmurakaru)! - The marker popover now floats one row above the marked words, mapped through the word-wrap geometry, instead of drifting to the block's linear character offset; it paints over neighboring blocks and tracks the content when scrolled. A drag released outside a block's text (the gutter, past a line end, a gap between blocks) now still opens the span popover.

- [#242](https://github.com/mmurakaru/cueloop/pull/242) [`311633c`](https://github.com/mmurakaru/cueloop/commit/311633c003680f757ec32dee8e2945ecca8694fc) Thanks [@mmurakaru](https://github.com/mmurakaru)! - Annotation and removal cards keep a transparent background when selected, so they sit flat on the transparent theme instead of painting an elevated fill. Selection now reads from the quote line taking the card's tone plus the matching document highlight. The submit-review card also drops its "N annotations · N blocking" line: the blocking count was always zero because nothing set an annotation's blocking flag, so the count and its plumbing are removed.

- Updated dependencies []:
  - @cueloop/adapters@0.1.0-alpha.45
  - @cueloop/client@0.1.0-alpha.45
  - @cueloop/daemon@0.1.0-alpha.45
  - @cueloop/schema@0.1.0-alpha.45

## 0.1.0-alpha.44

### Patch Changes

- [#238](https://github.com/mmurakaru/cueloop/pull/238) [`8711792`](https://github.com/mmurakaru/cueloop/commit/8711792baf193a956878155adb0936597f365196) Thanks [@mmurakaru](https://github.com/mmurakaru)! - A working-tree diff review now hot-reloads: while you have a `cueloop diff` session open, the daemon watches its repository and re-captures the diff whenever the working tree changes, so the review updates in place with no manual reload and no remount. Your annotations re-anchor across the refreshed patch through the usual anchor cascade. The daemon runs one recursive watcher per repository shared by its live diff sessions, debounces bursts of file writes into a single re-capture, ignores churn under `.git/` and `node_modules/`, and only broadcasts when the patch actually moved. A new owner-only `session.refreshDiff` verb is the seam the watcher drives and is scriptable on its own. Watching starts when a diff session is created (or recovered after a daemon restart) and stops when it resolves, is deleted, or the daemon shuts down.

- [#239](https://github.com/mmurakaru/cueloop/pull/239) [`0a97234`](https://github.com/mmurakaru/cueloop/commit/0a97234143a856c42d93877db44d7bd179241e01) Thanks [@mmurakaru](https://github.com/mmurakaru)! - Bring color back to the review rail cards. A prior change had made a card's border wear its tone only while selected, so every unselected card faded to one dim gray - the rail read as colorless. Cards now always carry their color and selection reads from a filled background instead: your own comments are salmon, a share collaborator's comments are blue (matching the Comment verdict), and cuts are red. Blue and red are softened to pastels that sit with the salmon accent. The submit-review box wears a white border and title (its Submit button stays salmon), and the Agent-tab launcher buttons get white borders so they read against the transparent session.

- Updated dependencies []:
  - @cueloop/adapters@0.1.0-alpha.44
  - @cueloop/client@0.1.0-alpha.44
  - @cueloop/daemon@0.1.0-alpha.44
  - @cueloop/schema@0.1.0-alpha.44

## 0.1.0-alpha.43

### Patch Changes

- [#228](https://github.com/mmurakaru/cueloop/pull/228) [`1c2cbc1`](https://github.com/mmurakaru/cueloop/commit/1c2cbc141e40f9202e5480313572f6a9b054d309) Thanks [@mmurakaru](https://github.com/mmurakaru)! - Fix the Claude harness never launching from the Agent tab. Its command was `cc`, which is a personal shell alias for `claude` - but the embedded terminal spawns the binary directly on a PTY, where `cc` resolves to the system C compiler, so the pane ran the compiler instead of Claude Code (`pi` and `codex` are real binaries, so they worked). The command is now `claude`. Also strips the `▸` glyphs from the launcher buttons and plan-context toggle, and removes the inline `(⌃])` detach hint from the running-terminal header - the detach chord is now listed in the Keybinds cheatsheet (Settings) under "Agent terminal" instead. Detaching now tears the terminal down explicitly (the React reconciler detaches a child without destroying it), so the agent's child process no longer leaks after ctrl+].

- [#228](https://github.com/mmurakaru/cueloop/pull/228) [`1c2cbc1`](https://github.com/mmurakaru/cueloop/commit/1c2cbc141e40f9202e5480313572f6a9b054d309) Thanks [@mmurakaru](https://github.com/mmurakaru)! - Tidy the Agent tab and rail width. The launcher is now three text-only buttons - "Claude Code", "Pi", "OpenAI Codex" - stacked tight without the ASCII logos, and all sharing one neutral color. Dropped the "Ask an agent about this plan" header and the bottom "<agent> · <status> · rev N" line (both redundant with the plan sheet header), so the buttons sit directly under the tabs. The rail also no longer indents its content: the tab body dropped a stray left padding (the Agent tab was indented two columns deeper than the Review tab) and the rail's own left padding, so annotation cards and the launcher buttons run full width from the divider seam.

- [#228](https://github.com/mmurakaru/cueloop/pull/228) [`1c2cbc1`](https://github.com/mmurakaru/cueloop/commit/1c2cbc141e40f9202e5480313572f6a9b054d309) Thanks [@mmurakaru](https://github.com/mmurakaru)! - Stop annotations from orphaning when their quote carries a leading markdown marker, and re-bind lightly edited quotes. The parser strips block markers (`- `, `## `, `1. `, `> `) from block text, so a quote copied verbatim from the source - bullet and all - never matched the exact/trimmed lookup and dropped straight to an orphaned anchor. The anchor resolver now runs a longer cascade: exact -> trimmed -> marker-normalized -> fuzzy -> orphan. Marker stripping shares one `stripLeadingBlockMarker` utility with the parser so the two cannot drift, and the fuzzy tier (`levenshteinDistance` / `similarityRatio` / `fuzzyFindBestMatch`, standalone in `@cueloop/schema`) re-anchors a quote after a small edit, gated by a high similarity floor so it never binds to the wrong text. Fixing this in the resolver heals anchors already stored in a session and covers every author path (local, agent, gateway).

- [#228](https://github.com/mmurakaru/cueloop/pull/228) [`1c2cbc1`](https://github.com/mmurakaru/cueloop/commit/1c2cbc141e40f9202e5480313572f6a9b054d309) Thanks [@mmurakaru](https://github.com/mmurakaru)! - Fix the Save and Cancel buttons in a saved annotation card's edit composer, which did nothing when clicked. The card is wrapped in a clickable box (`onMouseUp` selects/activates it), and a button press bubbled up to that box after firing, so activating the card immediately re-opened the editor and undid the action. Word-buttons now stop propagation on press, so a button inside any clickable surface consumes its own click instead of double-firing the ancestor.

- [#228](https://github.com/mmurakaru/cueloop/pull/228) [`1c2cbc1`](https://github.com/mmurakaru/cueloop/commit/1c2cbc141e40f9202e5480313572f6a9b054d309) Thanks [@mmurakaru](https://github.com/mmurakaru)! - The embedded Agent-tab terminal now drives its child through cueloop's own forkpty(3) FFI shim. The shim is a small `native/src/pty.zig` (spawn / non-blocking read / write / resize / reap) built by `build-pty.sh` with the same pinned Zig toolchain as the VT shim, loaded over `bun:ffi` from `packages/client/src/pty.ts`. This drops the last external native dependency, so all native code the client loads is now built and owned in-tree. Same graceful fallback as before: where no prebuilt shim ships for the platform, the launcher degrades to a herdr split. Verified end-to-end via the PTY e2e suite (alternate-screen render, raw-tty key routing, SIGWINCH resize, exit code).

- Updated dependencies []:
  - @cueloop/adapters@0.1.0-alpha.43
  - @cueloop/client@0.1.0-alpha.43
  - @cueloop/daemon@0.1.0-alpha.43
  - @cueloop/schema@0.1.0-alpha.43

## 0.1.0-alpha.42

### Patch Changes

- [#226](https://github.com/mmurakaru/cueloop/pull/226) [`4718977`](https://github.com/mmurakaru/cueloop/commit/471897715447959b746cfe4eb0278dcacf5c544b) Thanks [@mmurakaru](https://github.com/mmurakaru)! - Build the embedded terminal FFI shim with a verified Zig toolchain and test its complete cell contract from source.

- Updated dependencies []:
  - @cueloop/adapters@0.1.0-alpha.42
  - @cueloop/client@0.1.0-alpha.42
  - @cueloop/daemon@0.1.0-alpha.42
  - @cueloop/schema@0.1.0-alpha.42

## 0.1.0-alpha.41

### Minor Changes

- [#224](https://github.com/mmurakaru/cueloop/pull/224) [`a7c7ebe`](https://github.com/mmurakaru/cueloop/commit/a7c7ebe4fb4e584064704bf38994706e44773cc1) Thanks [@mmurakaru](https://github.com/mmurakaru)! - Run the review agent inside the Agent tab, not a separate pane. Picking claude code / pi / codex now embeds a real terminal in the rail: the harness runs on a PTY (bun-pty) through Ghostty's own VT core (libghostty-vt via a small FFI shim) and paints into the OpenTUI canvas cell-by-cell, with colors, text attributes, and a live cursor. While it is focused the keyboard routes to the agent; ctrl+] detaches back to the review. Where no prebuilt libghostty-vt ships for the platform, it falls back to the previous herdr-split launch, so nothing breaks. Ships a darwin-arm64 prebuilt today; other platforms use the split until their prebuilts land.

### Patch Changes

- Updated dependencies []:
  - @cueloop/adapters@0.1.0-alpha.41
  - @cueloop/client@0.1.0-alpha.41
  - @cueloop/daemon@0.1.0-alpha.41
  - @cueloop/schema@0.1.0-alpha.41

## 0.1.0-alpha.40

### Minor Changes

- [#221](https://github.com/mmurakaru/cueloop/pull/221) [`0c26b3f`](https://github.com/mmurakaru/cueloop/commit/0c26b3f8f164b6a89ce56108cf5de88118e751e4) Thanks [@mmurakaru](https://github.com/mmurakaru)! - Turn the review rail's Agent tab into a bring-your-own-harness launcher. It now shows branded claude code / pi / codex cards; clicking one runs that harness in a herdr split beside the review, so a reviewer can ask an agent about the plan without leaving the tab. A plan-context toggle seeds a briefing (read the plan, comment via `session annotate`, do not rewrite) into the launched split. The old dead agent/status/revision placeholder becomes a compact footer line.

- [#223](https://github.com/mmurakaru/cueloop/pull/223) [`778f601`](https://github.com/mmurakaru/cueloop/commit/778f601fce1633acf3a7e9b5896d45ec59385984) Thanks [@mmurakaru](https://github.com/mmurakaru)! - Enforce owner / collaborator / agent roles at the daemon socket. A connection is the owner by default (local single-user is unchanged); a review-side agent connects with `--role agent` (a `daemon.hello` handshake), and the daemon then caps it to reading the session and adding annotations - any attempt to resolve, submit a revision, edit, cut, share, or delete is refused. The capability map is one source of truth (`capabilities.ts`). The `cueloop:annotate` skill now passes `--role agent`, so a bring-your-own agent literally cannot escalate.

- [#222](https://github.com/mmurakaru/cueloop/pull/222) [`d740fd2`](https://github.com/mmurakaru/cueloop/commit/d740fd2f7077b81b0dd4ec1e02df82d4e54d1819) Thanks [@mmurakaru](https://github.com/mmurakaru)! - Add a Settings "Actions" category to edit the quick-action vocabulary. Each quick action is a row whose prompt, when clicked, expands a focused input for its system prompt (the guidance appended when the action is used); a reset-to-defaults control and an add-action row bracket the list. Edits persist to `[[actions]]` in the user config, so the presets a human picks and the ones an agent references via `annotate --action` stay one shared, editable set.

### Patch Changes

- [#219](https://github.com/mmurakaru/cueloop/pull/219) [`af1f33c`](https://github.com/mmurakaru/cueloop/commit/af1f33cfcbb4a0dbaa0fac9d9cbaccbb4107ca1c) Thanks [@mmurakaru](https://github.com/mmurakaru)! - Fix the plan-gate review opening no herdr tab when the daemon is stale. Recalling the recorded tab handle from the daemon is now isolated from the tab-open flow, so a daemon that predates the herdr-tab verbs (or any recall failure) degrades to opening a fresh tab instead of silently opening nothing. The store write is likewise best-effort: a failure loses only the liveness-dedup handle, never the already-open tab.

- Updated dependencies []:
  - @cueloop/adapters@0.1.0-alpha.40
  - @cueloop/client@0.1.0-alpha.40
  - @cueloop/daemon@0.1.0-alpha.40
  - @cueloop/schema@0.1.0-alpha.40

## 0.1.0-alpha.39

### Minor Changes

- [#217](https://github.com/mmurakaru/cueloop/pull/217) [`29bc936`](https://github.com/mmurakaru/cueloop/commit/29bc936be4e6b78985c77ccfe2368539b67e1196) Thanks [@mmurakaru](https://github.com/mmurakaru)! - Widen the annotation surface so review-side agents write the same authored, span-anchored comment a human does. `session annotate` now takes `--author` (and `--author-name`, which registers the collaborator's display name in the participant registry) and `--action <index|name>`, which expands a shared quick-action preset into the comment body. A new `cueloop actions list` prints that vocabulary so an agent can reference a preset by name. The built-in quick actions now ship with a system-prompt sentence each. A new `cueloop:annotate` skill wraps read-plus-comment for any bring-your-own harness, documenting the quote-exact anchor contract and the annotate-only rights boundary.

### Patch Changes

- Updated dependencies []:
  - @cueloop/adapters@0.1.0-alpha.39
  - @cueloop/client@0.1.0-alpha.39
  - @cueloop/daemon@0.1.0-alpha.39
  - @cueloop/schema@0.1.0-alpha.39

## 0.1.0-alpha.38

### Patch Changes

- [#209](https://github.com/mmurakaru/cueloop/pull/209) [`0425979`](https://github.com/mmurakaru/cueloop/commit/04259795106ebbb80ed96fb93a0e14eaee9ed82e) Thanks [@mmurakaru](https://github.com/mmurakaru)! - Re-planning in the same session now reliably shows the review in a herdr tab. Before, the auto-tab opened only for a brand-new review, so a resubmit whose original tab had been closed left an orphaned pending review with nothing on screen. cueloop now records the exact tab it opened (tab id + root pane id) in a herdr-namespaced daemon side-store - the core session model stays herdr-free - and on a resubmit checks that pane's liveness by id: a still-open tab is focused, a closed one is reopened, so there is never a duplicate and never a missing tab. Collision-free because it tracks the real ids, not a label.

- Updated dependencies []:
  - @cueloop/adapters@0.1.0-alpha.38
  - @cueloop/client@0.1.0-alpha.38
  - @cueloop/daemon@0.1.0-alpha.38
  - @cueloop/schema@0.1.0-alpha.38

## 0.1.0-alpha.37

### Patch Changes

- [#207](https://github.com/mmurakaru/cueloop/pull/207) [`5e48c65`](https://github.com/mmurakaru/cueloop/commit/5e48c65036769f1f919ad6059ecf17b19902aef0) Thanks [@mmurakaru](https://github.com/mmurakaru)! - The plan-mode gate is now the sole approval - no more double dialog. The `ExitPlanMode` hook was emitting a bare top-level `decision`, a shape Claude Code no longer recognizes, so it fell through to the native plan-approval dialog and you approved twice (once in cc's "approve / auto-accept" prompt, once in cueloop). The hook now returns the documented `hookSpecificOutput` PermissionRequest shape, which suppresses the native dialog: cueloop is the only place a plan is approved. To use vanilla plan mode, disable the plugin (`/plugin`, or `enabledPlugins: { "cueloop@cueloop": false }`).

- Updated dependencies []:
  - @cueloop/adapters@0.1.0-alpha.37
  - @cueloop/client@0.1.0-alpha.37
  - @cueloop/daemon@0.1.0-alpha.37
  - @cueloop/schema@0.1.0-alpha.37

## 0.1.0-alpha.36

### Minor Changes

- [#205](https://github.com/mmurakaru/cueloop/pull/205) [`93386e6`](https://github.com/mmurakaru/cueloop/commit/93386e68611a2b94e1a17b3810ba44fd7ad41069) Thanks [@mmurakaru](https://github.com/mmurakaru)! - The automatic plan-mode gate (the `ExitPlanMode` hook) is now non-blocking. Instead of freezing the turn until the reviewer decides, it opens the review, arms a detached inbox waiter, and denies the exit immediately - so the agent ends its turn and you keep chatting while the plan is open. When you submit a verdict cueloop injects it into the live session; on approval the agent presents the same plan again and is allowed through. This closes the last place plan review still blocked the agent.

### Patch Changes

- [#205](https://github.com/mmurakaru/cueloop/pull/205) [`7b6bf93`](https://github.com/mmurakaru/cueloop/commit/7b6bf934b86a8fd4ba57b0bf874c27040eaf9fca) Thanks [@mmurakaru](https://github.com/mmurakaru)! - The plan, diff, and review skills no longer block the agent on `session wait`. They submit the review, arm a detached `cueloop wake` that injects the verdict into the live session over the inbox socket, and end the turn - so the human keeps chatting while the review is open and the agent resumes itself when the verdict lands. A `session wait` fallback stays for sessions with no messaging inbox.

- Updated dependencies []:
  - @cueloop/adapters@0.1.0-alpha.36
  - @cueloop/client@0.1.0-alpha.36
  - @cueloop/daemon@0.1.0-alpha.36
  - @cueloop/schema@0.1.0-alpha.36

## 0.1.0-alpha.35

### Minor Changes

- [#203](https://github.com/mmurakaru/cueloop/pull/203) [`607dfee`](https://github.com/mmurakaru/cueloop/commit/607dfee539e8a216e610a68d467d54d0fa1a09a3) Thanks [@mmurakaru](https://github.com/mmurakaru)! - Non-blocking review with a per-harness wake (ADR 0008). A plan can now be submitted without freezing the agent's turn: the human keeps chatting while the plan is open, and when they return a verdict cueloop resumes the driving agent with the feedback instead of relying on the harness to re-poll a blocked tool.

  - daemon: a new `awaitResolve(client, sessionId)` seam parks on one session's verdict from a session id alone (no ReviewHandle needed), so any background waiter can collect the outcome; the held connection and the pending session both keep the daemon off its idle-exit path for the whole wait.
  - pi: the `request_review` tool returns immediately with the session id and a background waiter injects the verdict with `sendUserMessage(deliverAs: "followUp")` when it lands; the pending-review write gate still holds mutating tools, and session shutdown aborts any waiter still parked.
  - Claude Code: a detached inbox waiter posts the verdict into the live session over `CLAUDE_CODE_MESSAGING_SOCKET` (the frame matched to Claude Code's own example), which Claude reads between tool calls or as a fresh turn when idle. The blocking ExitPlanMode gate is unchanged.
  - Codex: a detached waiter queues the verdict into the running thread via `codex queue` (app-server `thread/queue/add`), which auto-submits when the thread next goes idle. Weakest of the three paths - it needs Codex under the shared app-server daemon and still wants live-codex QA.

### Patch Changes

- [#202](https://github.com/mmurakaru/cueloop/pull/202) [`53f0805`](https://github.com/mmurakaru/cueloop/commit/53f080504a57c7f00bfa1b0f6a13ee11e155436c) Thanks [@mmurakaru](https://github.com/mmurakaru)! - Fix herdr tab auto-open: a review created inside a herdr pane now opens a new tab rendering it, as intended. `detectHerdr` required `HERDR_BIN_PATH`, which herdr 0.8+ does not set - it exposes `HERDR_SOCKET_PATH` and the `herdr` CLI on PATH - so detection silently failed and the auto-open (and agent-state reporting) no-op'd. `detectHerdr` now needs only `HERDR_ENV=1` + `HERDR_PANE_ID` and defaults the binary to `herdr` on PATH; an explicit `HERDR_BIN_PATH` still wins.

- Updated dependencies []:
  - @cueloop/adapters@0.1.0-alpha.35
  - @cueloop/client@0.1.0-alpha.35
  - @cueloop/daemon@0.1.0-alpha.35
  - @cueloop/schema@0.1.0-alpha.35

## 0.1.0-alpha.34

### Minor Changes

- [#195](https://github.com/mmurakaru/cueloop/pull/195) [`7305b22`](https://github.com/mmurakaru/cueloop/commit/7305b2237671cf5be3a8681c67e6c01c2ff8b9fb) Thanks [@mmurakaru](https://github.com/mmurakaru)! - Rejected diff hunks and cut plan blocks now appear in the review rail as their own cards, interleaved with annotation cards in reading order rather than grouped at the bottom. Each removal card previews the removed content struck through and dimmed; selecting one reveals its source line and shows an undo button (the same restore path as the `u` key), so a rejection reads like any other queued item you can take back before you submit. Inline, a cut span is now simply struck through and grayed rather than boxed with a `[cut]` tag, and saved annotation cards carry a uniform bordered frame titled `ACTION · author`. The composer's Cancel button drops its redundant ` esc` hint (esc still cancels).

  Keyboard scrolling in the diff sheet is now smooth: the layout model counted a wrapped annotation body or file header as one row while it rendered as several, so the cursor-follow scroll drifted and shifted the view. Those content lines no longer wrap, so the scroll target matches the real layout and the cursor holds a stable screen row.

- [#196](https://github.com/mmurakaru/cueloop/pull/196) [`b241ac8`](https://github.com/mmurakaru/cueloop/commit/b241ac8398871f67a141e909ad72292a8245cadd) Thanks [@mmurakaru](https://github.com/mmurakaru)! - Annotations collapse to a single `comment` kind. The `s` suggest keybinding is gone (the key is now unbound), and the suggestion "Replace/With" feedback rendering is removed - every annotation serializes as a comment. Working-copy edits and hunk curation already give a stronger, directly-applied way to propose a concrete change, so the suggestion kind was redundant.

  BREAKING (alpha) for `@cueloop/schema`: `AnnotationKind` no longer lists `"suggestion"`. The kind set stays open (`"comment" | (string & {})`) for forward-compat with agent notes and other kinds.

- [#197](https://github.com/mmurakaru/cueloop/pull/197) [`69a7aa1`](https://github.com/mmurakaru/cueloop/commit/69a7aa1a3ef3410ed58167b49ad34954fd2330fa) Thanks [@mmurakaru](https://github.com/mmurakaru)! - Add the marker-actions popover to plan review: marking a span (`v`) now shows an inline toolbar at the block - `comment · cut · actions · [x]` - each label keyboard-shortcut-backed and clickable, so span mode is discoverable rather than blind. `a` opens a quick-actions list of preset comments you pick with `j`/`k` and `⏎` (or a click), inserting the prompt as a comment on the span in one step; `x` cuts the whole block the span sits in. The list is configurable through a new `[[actions]]` config section (`prompt` plus optional `metadata`); defining any replaces the built-in review prompts. A mouse drag-select on a plan also opens the popover at the dragged range - one marker at a time.

- [#195](https://github.com/mmurakaru/cueloop/pull/195) [`7305b22`](https://github.com/mmurakaru/cueloop/commit/7305b2237671cf5be3a8681c67e6c01c2ff8b9fb) Thanks [@mmurakaru](https://github.com/mmurakaru)! - Pick a built-in color theme from Settings. A new Appearance tab cycles through the branded `cueloop` default (transparent, so your terminal background shows through) and five well-known palettes rendered from their first-party specs - Rosé Pine Moon, Catppuccin Mocha, Tokyo Night, Gruvbox Dark, and Nord - each painting its own opaque background. The choice applies live and persists to `[ui] theme` in your config; per-token `[theme]` overrides still layer on top of whichever preset you pick, so a hand-tuned accent survives a theme switch.

### Patch Changes

- [#193](https://github.com/mmurakaru/cueloop/pull/193) [`8d8abab`](https://github.com/mmurakaru/cueloop/commit/8d8ababc2c44b3a7352f18c7341af01d23f6042a) Thanks [@mmurakaru](https://github.com/mmurakaru)! - Diff hunk curation: while reviewing a working-tree diff, the owner can accept or reject individual hunks and changes in the terminal. `x` rejects (or restores) the change under the cursor, `⇧X` the whole hunk; rejected lines render struck through and dimmed. The curated result - the accepted changes only - becomes the review's working copy and flows to the agent as feedback, serialized as an exactly applyable unified diff.

  To make that exact, `cueloop diff` now captures the full old/new contents of every changed file (new optional `Artifact.files`), and curation re-parses each file with `@pierre/diffs` so a reject reverts precisely the chosen hunk or change. PR reviews carry a partial patch with no file contents, so curation stays disabled there with a clear status message.

- [#191](https://github.com/mmurakaru/cueloop/pull/191) [`36f70b6`](https://github.com/mmurakaru/cueloop/commit/36f70b63a6a441a68013755d5f69c7de00ecf579) Thanks [@mmurakaru](https://github.com/mmurakaru)! - The diff review sheet now syntax-highlights code with tree-sitter: keywords, types, strings, and the rest wear their theme colors across context, added, and deleted lines, resolved off the render path so rows draw unstyled first. It composes with the intra-line word diff - a changed word keeps the diff color on top of its syntax color - and leaves the row-level annotation cards untouched. A hunk is highlighted as a contiguous fragment (so multi-line constructs tokenize correctly) and the filetype comes from the file path.

- [#190](https://github.com/mmurakaru/cueloop/pull/190) [`d5ef124`](https://github.com/mmurakaru/cueloop/commit/d5ef124532a4e5137cc0a6ca8a1bf7b8dee840e1) Thanks [@mmurakaru](https://github.com/mmurakaru)! - The diff review sheet now highlights the change within a modified line, not just the whole line: a deletion paired with its addition is word-diffed so the removed and added words keep the diff color while the unchanged part of the line dims. The plan tracked-changes view shares the same engine. Both are backed by a single whitespace-lossless word-diff (jsdiff diffWordsWithSpace), replacing the coarser home-grown LCS word diff, so quote anchors stay exact. In a multi-line hunk, lines are aligned to their real counterpart by similarity (not by position), so an inserted or removed line never paints a misleading word diff against an unrelated line.

  BREAKING (alpha): `@cueloop/schema` no longer exports `wordDiff` - it is superseded by the client-side word-diff engine and had no other consumer. `lcsDiff` (its building block) stays exported.

- [#188](https://github.com/mmurakaru/cueloop/pull/188) [`467edb7`](https://github.com/mmurakaru/cueloop/commit/467edb741337a871393edb26cac68721d8b173cf) Thanks [@mmurakaru](https://github.com/mmurakaru)! - The share toast now paints on the same solid dark panel as the Settings and Keybinds dialogs, so its text stays legible over the transparent session. Sharing a plan no longer also writes an inline "share link copied" line below the plan sheet - the centered toast is the single notification for the copied ssh line.

- Updated dependencies [[`8d8abab`](https://github.com/mmurakaru/cueloop/commit/8d8ababc2c44b3a7352f18c7341af01d23f6042a), [`b241ac8`](https://github.com/mmurakaru/cueloop/commit/b241ac8398871f67a141e909ad72292a8245cadd), [`d5ef124`](https://github.com/mmurakaru/cueloop/commit/d5ef124532a4e5137cc0a6ca8a1bf7b8dee840e1)]:
  - @cueloop/schema@0.1.0-alpha.34
  - @cueloop/client@0.1.0-alpha.34
  - @cueloop/daemon@0.1.0-alpha.34

## 0.1.0-alpha.33

### Patch Changes

- Updated dependencies [[`c1f3ab2`](https://github.com/mmurakaru/cueloop/commit/c1f3ab2b22ceed5ff2b157b42f5c5df9b1ff6845)]:
  - @cueloop/client@0.1.0-alpha.33
  - @cueloop/daemon@0.1.0-alpha.33
  - @cueloop/schema@0.1.0-alpha.33

## 0.1.0-alpha.32

### Patch Changes

- Updated dependencies [[`010b7a9`](https://github.com/mmurakaru/cueloop/commit/010b7a9837e0263a4779729d492ba0fd51eba8db), [`010b7a9`](https://github.com/mmurakaru/cueloop/commit/010b7a9837e0263a4779729d492ba0fd51eba8db)]:
  - @cueloop/client@0.1.0-alpha.32
  - @cueloop/daemon@0.1.0-alpha.32
  - @cueloop/schema@0.1.0-alpha.32

## 0.1.0-alpha.31

### Patch Changes

- Updated dependencies [[`3cfa5e0`](https://github.com/mmurakaru/cueloop/commit/3cfa5e065d897b3f27f3fe81f7e999e52731f24a)]:
  - @cueloop/client@0.1.0-alpha.31
  - @cueloop/daemon@0.1.0-alpha.31
  - @cueloop/schema@0.1.0-alpha.31

## 0.1.0-alpha.30

### Patch Changes

- [#173](https://github.com/mmurakaru/cueloop/pull/173) [`c6a18ef`](https://github.com/mmurakaru/cueloop/commit/c6a18ef8fd6165dda8f05ca6ccc51306943ee4f4) Thanks [@dependabot](https://github.com/apps/dependabot)! - Bump the `@opentui/*` group (core, react, keymap, ssh) from 0.5.1 to 0.5.2.

- [#172](https://github.com/mmurakaru/cueloop/pull/172) [`b1f55f9`](https://github.com/mmurakaru/cueloop/commit/b1f55f9aff7e6383b2067211a7f16847e9e430a0) Thanks [@mmurakaru](https://github.com/mmurakaru)! - `cueloop -v` / `cueloop --version` (and the bare `version` verb) now print the installed version and exit 0, instead of dumping the help text and exiting 2. `-h` is added as an alias for `--help`, and both are listed in the help output.

- Updated dependencies []:
  - @cueloop/client@0.1.0-alpha.30
  - @cueloop/daemon@0.1.0-alpha.30
  - @cueloop/schema@0.1.0-alpha.30

## 0.1.0-alpha.29

### Minor Changes

- [#169](https://github.com/mmurakaru/cueloop/pull/169) [`3d676af`](https://github.com/mmurakaru/cueloop/commit/3d676af92235fe4dfe30d2a70953d4bf4252f082) Thanks [@mmurakaru](https://github.com/mmurakaru)! - Add an opt-in Prometheus `/metrics` endpoint to the sharing gateway (ADR 0007, Layer 2). Off by default and bound to loopback - it starts only when `CUELOOP_METRICS_PORT` is set, so it never faces the public port and production is unchanged until an operator opts in. It exposes share-verb success/error counts + latency (`cueloop_share_ops_total`, `cueloop_share_op_duration_seconds`) and R2 operation outcomes (`cueloop_r2_ops_total`), the SLIs a scraping agent (e.g. Grafana Cloud) needs. Box CPU/mem/disk stay the agent's node integration.

### Patch Changes

- Updated dependencies []:
  - @cueloop/client@0.1.0-alpha.29
  - @cueloop/daemon@0.1.0-alpha.29
  - @cueloop/schema@0.1.0-alpha.29

## 0.1.0-alpha.28

### Patch Changes

- [#165](https://github.com/mmurakaru/cueloop/pull/165) [`70b312a`](https://github.com/mmurakaru/cueloop/commit/70b312a37a0f063859c5a560d0bd56b3c8f58125) Thanks [@mmurakaru](https://github.com/mmurakaru)! - Fix the gateway leaving a collaborator's terminal in mouse-reporting mode. Quitting a shared plan now restores the terminal (disables mouse reporting, shows the cursor, leaves the alt screen) before the channel closes, so the local terminal no longer spews raw SGR mouse reports on every mouse move until `reset`. Previously the restore only ran after the channel had already closed, which dropped the bytes.

- Updated dependencies []:
  - @cueloop/client@0.1.0-alpha.28
  - @cueloop/daemon@0.1.0-alpha.28
  - @cueloop/schema@0.1.0-alpha.28

## 0.1.0-alpha.27

### Minor Changes

- [#156](https://github.com/mmurakaru/cueloop/pull/156) [`7464609`](https://github.com/mmurakaru/cueloop/commit/7464609c7320f32ba1f3ab3123b9b353bb925341) Thanks [@mmurakaru](https://github.com/mmurakaru)! - Name and manage collaborators. A share viewer is asked for a display name the first time they open a shared plan, so their notes attribute to a name rather than an SSH fingerprint; skipping keeps them anonymous, and a name from a past visit is remembered. The planner can rename any collaborator from the rail - r on a selected note, or activate the note (click it again, or e) - stored per fingerprint in the user config. The inbox gains a delete action (d, or the [delete] button) behind a centered confirm dialog, so finished plans can be cleared.

- [#156](https://github.com/mmurakaru/cueloop/pull/156) [`7464609`](https://github.com/mmurakaru/cueloop/commit/7464609c7320f32ba1f3ab3123b9b353bb925341) Thanks [@mmurakaru](https://github.com/mmurakaru)! - Attribute collaborator annotations in the review rail. A note pulled from a shared plan now renders as a bordered card titled with the author's handle (derived from their SSH fingerprint until display names are captured), so a teammate's notes stand out from your own - which stay borderless. Own-only rails are unchanged.

### Patch Changes

- [#163](https://github.com/mmurakaru/cueloop/pull/163) [`d38cefd`](https://github.com/mmurakaru/cueloop/commit/d38cefd505e21ccbd920ba578eec041f51c0cc41) Thanks [@mmurakaru](https://github.com/mmurakaru)! - Collaborator names now reach the planner on pull. Pulling a shared plan merges the participant registry (union by id) alongside the collaborator notes, so a teammate who named themselves resolves to that name in the review rail instead of a raw SSH fingerprint. A collaborator who left a note without naming themselves reads as anonymous. The daemon's `session.mergeAnnotations` verb becomes `session.mergeShared`, carrying both the notes and the identities behind them.

- Updated dependencies []:
  - @cueloop/client@0.1.0-alpha.27
  - @cueloop/daemon@0.1.0-alpha.27
  - @cueloop/schema@0.1.0-alpha.27

## 0.1.0-alpha.26

### Patch Changes

- [#151](https://github.com/mmurakaru/cueloop/pull/151) [`4110683`](https://github.com/mmurakaru/cueloop/commit/41106835ae166c0926d55d202a8e2c29f2121a27) Thanks [@mmurakaru](https://github.com/mmurakaru)! - Gateway connection-error logging is now classified: expected transport failures (bad handshake, auth abort, connection reset) from internet scanners on port 22 log one terse line instead of a full stack trace, while genuinely unexpected errors stay loud. Cuts log noise without hiding real faults.

- Updated dependencies []:
  - @cueloop/client@0.1.0-alpha.26
  - @cueloop/daemon@0.1.0-alpha.26
  - @cueloop/schema@0.1.0-alpha.26

## 0.1.0-alpha.25

### Minor Changes

- [#148](https://github.com/mmurakaru/cueloop/pull/148) [`137f92c`](https://github.com/mmurakaru/cueloop/commit/137f92c08f8c3c235dc9b38def27778e336f5686) Thanks [@mmurakaru](https://github.com/mmurakaru)! - Near-live sync for shared plans. While you have a plan you shared open, cueloop now re-pulls collaborator notes every few seconds, so a teammate's comments stream in without reopening anything. It is bidirectional: your own notes and edits on a shared plan mirror up to the share, so collaborators see them on their next refresh. Everything still converges by id, so order never matters and there is nothing to resolve by hand.

- [#145](https://github.com/mmurakaru/cueloop/pull/145) [`6fb25ca`](https://github.com/mmurakaru/cueloop/commit/6fb25caaa5c9b8d4176c67a459d03687e572226b) Thanks [@mmurakaru](https://github.com/mmurakaru)! - Pull collaborator notes on a shared plan back to the planner. When you share a plan, cueloop now records the share id on the session; `cueloop share pull [session-id]` (and opening a shared plan in the TUI) fetches the share's current notes and unions them into your local plan by id, so teammates' comments show up without losing your own. The gateway lets only the fingerprint that created the share pull it back.

### Patch Changes

- [#141](https://github.com/mmurakaru/cueloop/pull/141) [`20a1e03`](https://github.com/mmurakaru/cueloop/commit/20a1e03ff0e73020ee5b23954f3ed04ac6224e9c) Thanks [@mmurakaru](https://github.com/mmurakaru)! - The Share affordance moves out of the review rail and into the plan sheet header, inline next to Edit, with a plain "Share" label. It renders under the same owner-only gate as Edit, so `cueloop serve` observers and share collaborators still see neither button. The `⇧S` share keybinding and the underlying share intent are unchanged.

- Updated dependencies []:
  - @cueloop/client@0.1.0-alpha.25
  - @cueloop/daemon@0.1.0-alpha.25
  - @cueloop/schema@0.1.0-alpha.25

## 0.1.0-alpha.24

### Patch Changes

- [#137](https://github.com/mmurakaru/cueloop/pull/137) [`eaa017e`](https://github.com/mmurakaru/cueloop/commit/eaa017e0fe448c54da80396e7373004a390fb57a) Thanks [@mmurakaru](https://github.com/mmurakaru)! - `cueloop --help` now prints a grouped catalogue instead of a flat wall: the everyday verbs (`plan`, `diff`, `review`) sit under "common commands", with "share", "open a specific review", and "scripting" following. The command coverage is unchanged - the same entries, just organized so the common path is what you see first.

- Updated dependencies []:
  - @cueloop/client@0.1.0-alpha.24
  - @cueloop/daemon@0.1.0-alpha.24
  - @cueloop/schema@0.1.0-alpha.24

## 0.1.0-alpha.23

### Patch Changes

- [#136](https://github.com/mmurakaru/cueloop/pull/136) [`ad0cda6`](https://github.com/mmurakaru/cueloop/commit/ad0cda666ee004d612be8607abf14c9f588eaa4e) Thanks [@mmurakaru](https://github.com/mmurakaru)! - A plan shared over SSH now hides every plan-edit affordance from the viewer: the sheet-header Edit button is owner-only, the edit/cut keys are silent instead of nagging "shared plan - edit it in your own copy", and the hint strip drops cut/edit/submit. A collaborator still annotates, navigates, and edits their own notes.

- Updated dependencies []:
  - @cueloop/client@0.1.0-alpha.23
  - @cueloop/daemon@0.1.0-alpha.23
  - @cueloop/schema@0.1.0-alpha.23

## 0.1.0-alpha.22

### Minor Changes

- [#131](https://github.com/mmurakaru/cueloop/pull/131) [`3b8aa11`](https://github.com/mmurakaru/cueloop/commit/3b8aa1115923692c7bdfde1b855abef2e8f1d5b5) Thanks [@mmurakaru](https://github.com/mmurakaru)! - Annotations now resolve when a revision addresses them, so re-review shows only what is still open. The feedback document lists each annotation's id and teaches the agent to report what it acted on (`cueloop session submit-revision <id> --addressed <id,id>`); reported annotations are marked addressed by that revision. As an assist, a plan revision that removed an annotation's quoted text marks it addressed too ("drift"). Addressed annotations leave the rail (a dim `✓ N addressed by revision` line keeps the count), lose their document highlight, stop counting toward the pending badge and the verdict default, and stay out of the next feedback document - but they are never deleted from the session record.

- [#135](https://github.com/mmurakaru/cueloop/pull/135) [`a6ab587`](https://github.com/mmurakaru/cueloop/commit/a6ab5874d3c879b3fa28a114c6f9c47099f76abf) Thanks [@mmurakaru](https://github.com/mmurakaru)! - SSH plan sharing: `cueloop share` (and a one-click Share button / ⇧S in the plan TUI) publishes a plan as one line - `ssh p_xxxxxxxx@cueloop.dev` - copied to the clipboard. A teammate pastes it and the plan renders in their terminal, no install, with every annotation already on it. They annotate too, and their notes union back into the shared blob attributed by SSH key, never overwriting the planner's. Backed by a new SSH gateway (raw ssh2, one port, shell renders / exec uploads) that seals each blob (AES-256-GCM, per-blob HKDF key) before it reaches R2. Annotations gain an optional `author` fingerprint; the review controller now renders the same TUI against a local session or a decrypted share.

### Patch Changes

- [#130](https://github.com/mmurakaru/cueloop/pull/130) [`f9980cc`](https://github.com/mmurakaru/cueloop/commit/f9980ccb6aaa0ac76e61a0ef57a5e062986d486d) Thanks [@mmurakaru](https://github.com/mmurakaru)! - Fixed herdr auto-open silently doing nothing. The `tab create` response parser expected `result.pane.id`, but real herdr (0.8.0) returns `result.root_pane.pane_id` - so a review created inside herdr never actually opened its tab. Verified against the real binary; the test stub now mirrors the real output shape.

- Updated dependencies []:
  - @cueloop/client@0.1.0-alpha.22
  - @cueloop/daemon@0.1.0-alpha.22
  - @cueloop/schema@0.1.0-alpha.22

## 0.1.0-alpha.21

### Minor Changes

- [#123](https://github.com/mmurakaru/cueloop/pull/123) [`fd0da2c`](https://github.com/mmurakaru/cueloop/commit/fd0da2cb1c0fda95222d7f79fd862591ff45b3cb) Thanks [@mmurakaru](https://github.com/mmurakaru)! - The annotation composer now follows the Slack newline convention. Plain Enter still saves the note, while Option/Alt+Enter (and Shift+Enter, as before) insert a newline so you can write a multi-line comment without leaving the box; Cmd/Ctrl+Enter is a submit alias. The input also auto-grows as you type: a long line that soft-wraps expands the box the same way a hard newline does, up to four rows, after which it scrolls internally and keeps the caret line in view.

- [#121](https://github.com/mmurakaru/cueloop/pull/121) [`0cd06f9`](https://github.com/mmurakaru/cueloop/commit/0cd06f96b4a8a8a90c6fdc76f8f033d29e8b6f6a) Thanks [@mmurakaru](https://github.com/mmurakaru)! - A review created from inside herdr now opens itself. When the Claude Code hook or `cueloop session create` starts a genuinely new review from a herdr pane, cueloop opens a fresh herdr tab, focuses it, and launches the review in it - no more copying a command out of the log by hand. A resubmit reuses the pane the original review already opened, so revisions never spam new tabs. It stays best-effort like the rest of the herdr tier: a missing or broken herdr binary is swallowed and never blocks the review, and outside herdr nothing changes.

- [#124](https://github.com/mmurakaru/cueloop/pull/124) [`00d66e4`](https://github.com/mmurakaru/cueloop/commit/00d66e47dce773d235ee4a982695341b0c371a78) Thanks [@mmurakaru](https://github.com/mmurakaru)! - The review panel now resizes and collapses so the plan gets the width it needs. It cycles through three states with `b`: expanded (the full annotation rail), compact (a narrow strip that keeps the count and one kind-colored dot per annotation - accent for a comment, green for a suggestion), and hidden (gone entirely, so the plan takes the full terminal, reopened with the same key and no leftover tab). Drag the single-column divider between the plan and the rail to resize the expanded width, or nudge it with `[` and `]`; the divider accents while you drag and the width is clamped to a sensible range. A muted chevron on the panel's edge toggles expanded and compact with a click (`»` to collapse, `«` to expand). The collapse state and rail width persist to `[ui] review_state` and `[ui] review_width` in your config, so the layout you pick survives a restart.

- [#119](https://github.com/mmurakaru/cueloop/pull/119) [`5555790`](https://github.com/mmurakaru/cueloop/commit/55557901fa16c9ae086e9a998de31aef0ac0e3db) Thanks [@mmurakaru](https://github.com/mmurakaru)! - Opening a review is now verb-first: one verb per artifact type, each defaulting to the latest pending review of that type. `cueloop plan` opens the latest pending plan, `cueloop diff` opens the latest pending diff, and `cueloop review` opens the latest pending PR review. Each verb also addresses a specific session directly - `cueloop plan <session-id>` by id, or `cueloop plan <title>` by a case-insensitive title match (an exact title wins, a unique substring wins, and several matches list the candidates so you can name one). An explicit `--latest` (alias `--open`) always selects the default. The create paths stay: `cueloop diff` with a dirty working tree still creates a working-tree review, a clean tree opens the latest pending diff instead of erroring, and `cueloop review <pr>` still opens a pull request. Bare `cueloop` still opens the inbox and `cueloop <session-id>` still opens that session. A miss prints a plain "nothing to open" line instead of failing silently.

### Patch Changes

- [#122](https://github.com/mmurakaru/cueloop/pull/122) [`ff9d791`](https://github.com/mmurakaru/cueloop/commit/ff9d791902f5b1f4c88a37b36017093e74990a2d) Thanks [@mmurakaru](https://github.com/mmurakaru)! - Bordered frames now read their corner style from one design-system token, `FRAME_BORDER_STYLE`, instead of each frame hardcoding its own value. Cards, dialogs, and the stories gallery chrome all resolve their rounded corners from this single source of truth, so the frame look can never drift between surfaces. Buttons stay text-first and borderless - the frame they sit in carries the border, not the button.

- Updated dependencies []:
  - @cueloop/client@0.1.0-alpha.21
  - @cueloop/daemon@0.1.0-alpha.21
  - @cueloop/schema@0.1.0-alpha.21

## 0.1.0-alpha.20

### Patch Changes

- [#110](https://github.com/mmurakaru/cueloop/pull/110) [`c3616b9`](https://github.com/mmurakaru/cueloop/commit/c3616b9f66493a90b0feb93443e81894d3785035) Thanks [@mmurakaru](https://github.com/mmurakaru)! - Edit mode now works for every reviewer, in any shell. The editor resolves through `[ui] editor` config, then `$CUELOOP_EDITOR`/`$VISUAL`/`$EDITOR`, then a `nano` fallback, so a clean environment can still edit a plan (it used to throw). Known GUI editors get their wait flag applied automatically (`code --wait`, `subl --new-window --wait`, `zed --wait`, ...), and any editor that returns instantly with the file untouched drops to a confirm gate on the released terminal ("save and close it, then press Enter") instead of silently discarding the edit. Terminal editors are trusted to hold the terminal and never see the gate.

- Updated dependencies []:
  - @cueloop/client@0.1.0-alpha.20
  - @cueloop/daemon@0.1.0-alpha.20
  - @cueloop/schema@0.1.0-alpha.20

## 0.1.0-alpha.19

### Patch Changes

- [#104](https://github.com/mmurakaru/cueloop/pull/104) [`7f765fe`](https://github.com/mmurakaru/cueloop/commit/7f765fe242cd1d4df645352abb634fc15fdc4399) Thanks [@mmurakaru](https://github.com/mmurakaru)! - Shrink the extension-api seam to what a second integration actually needs. Delete the zero-caller loader.ts (extension discovery, repo-trust store) and trim the contract to the exporter surface every consumer uses: Registry captures an extension's exporters and isolates a throwing factory; the renderer/command/keybinding/listener hooks that no extension registered are gone. Decouple the session controller from the concrete Obsidian integration: a new client integrations.ts composes the configured integrations into generic BundledExporter values (an Exporter plus its per-verdict run policy), so the controller depends only on the extension seam, never on an integration's own config type. Adding a second markdown-vault exporter is now a small addition to that composer rather than a change to the controller. No behavior change.

- Updated dependencies []:
  - @cueloop/client@0.1.0-alpha.19
  - @cueloop/daemon@0.1.0-alpha.19
  - @cueloop/schema@0.1.0-alpha.19

## 0.1.0-alpha.18

### Patch Changes

- [#102](https://github.com/mmurakaru/cueloop/pull/102) [`f5caa03`](https://github.com/mmurakaru/cueloop/commit/f5caa03f15e96bed2e03451d1738b938b979367d) Thanks [@mmurakaru](https://github.com/mmurakaru)! - Single-source the herdr env contract in @cueloop/schema (detectHerdr, insideHerdr, returnPaneFor) so the reviewer-side return-focus and the agent-side state reporting can no longer drift on which variables are required. focusHerdrPane now takes the herdr binary path as an argument, resolved once by the caller through detectHerdr, instead of re-reading HERDR_BIN_PATH with its own "herdr"-on-PATH fallback - so the reviewer side and the reporting side agree that the binary path is part of the contract. The two IO helpers stay with their sole consumers (focusHerdrPane in client, reportState/reportLabel in adapters). Narrow the @cueloop/daemon barrel to the two names imported bare (DaemonServer, cueloopHome); the client and review helpers keep coming through the ./client and ./review subpaths. No behavior change inside a herdr pane, where the binary path is always set.

- Updated dependencies []:
  - @cueloop/client@0.1.0-alpha.18
  - @cueloop/daemon@0.1.0-alpha.18
  - @cueloop/schema@0.1.0-alpha.18

## 0.1.0-alpha.17

### Patch Changes

- [#100](https://github.com/mmurakaru/cueloop/pull/100) [`a0f6012`](https://github.com/mmurakaru/cueloop/commit/a0f601238c775e38044c6c973a6adb845c31b299) Thanks [@mmurakaru](https://github.com/mmurakaru)! - Rename internals so every identifier states what it does: diff op fields (kind/oldValue/newValue), diff row kinds, key intents, and abbreviated locals across all packages; remove dead code and stale comments. No behavior change.

- Updated dependencies []:
  - @cueloop/client@0.1.0-alpha.17
  - @cueloop/daemon@0.1.0-alpha.17
  - @cueloop/schema@0.1.0-alpha.17

## 0.1.0-alpha.16

### Minor Changes

- [#98](https://github.com/mmurakaru/cueloop/pull/98) [`5454e5f`](https://github.com/mmurakaru/cueloop/commit/5454e5f8e613dd08c3f175fcfbab275599482e16) Thanks [@mmurakaru](https://github.com/mmurakaru)! - Guided walk for diff reviews: press w in a diff session to step through every
  changed file as a focused card wizard with a plain step count. ] advances and
  marks the file viewed (persisted with the session, so a resumed review keeps
  its progress), [ steps back, esc leaves keeping progress, and the end card
  offers Submit review directly. Submitting agents can attach per-file notes
  (annotations with kind "note" anchored by the file path) that render in the
  wizard's agent-note block and as rail cards; notes are agent context and never
  come back as reviewer feedback. The submit confirm shows the honest viewed
  count for walked diff sessions.

### Patch Changes

- Updated dependencies []:
  - @cueloop/client@0.1.0-alpha.16
  - @cueloop/daemon@0.1.0-alpha.16
  - @cueloop/schema@0.1.0-alpha.16

## 0.1.0-alpha.15

### Patch Changes

- [#96](https://github.com/mmurakaru/cueloop/pull/96) [`09b3416`](https://github.com/mmurakaru/cueloop/commit/09b3416c0fa160b2e3d08d7b8a2a7ca923bff78a) Thanks [@mmurakaru](https://github.com/mmurakaru)! - The post-submit overlay is clearer: it counts down from 5 seconds by default (esc stays, a remembers the choice) instead of a static prompt, the action line reads as plain "label [key]" affordances with no glyphs (close [return] · closing in Ns · return to plan [esc] · always [a]), and the redundant verdict echo under the heading is gone.

- Updated dependencies []:
  - @cueloop/client@0.1.0-alpha.15
  - @cueloop/daemon@0.1.0-alpha.15
  - @cueloop/schema@0.1.0-alpha.15

## 0.1.0-alpha.14

### Patch Changes

- [#94](https://github.com/mmurakaru/cueloop/pull/94) [`fe85a17`](https://github.com/mmurakaru/cueloop/commit/fe85a176f6a3620588bfddedfb681bb85347229e) Thanks [@mmurakaru](https://github.com/mmurakaru)! - The verdict selector in the submit confirm card reads horizontally - Comment / Approve / Changes as one row of pressable words - instead of a stacked vertical list, and the card shrinks by two rows.

- [#93](https://github.com/mmurakaru/cueloop/pull/93) [`65b024a`](https://github.com/mmurakaru/cueloop/commit/65b024abbb1d0350310dcf10616ae1fbf20c35c9) Thanks [@mmurakaru](https://github.com/mmurakaru)! - Fix: frames larger than the kernel socket buffer no longer truncate mid-line. Both the daemon and the client now honor socket backpressure - a partial write keeps its unwritten tail and flushes it on drain, so sessions with several revisions stay readable instead of wedging every request after the first oversized response.

- Updated dependencies []:
  - @cueloop/client@0.1.0-alpha.14
  - @cueloop/daemon@0.1.0-alpha.14
  - @cueloop/schema@0.1.0-alpha.14

## 0.1.0-alpha.13

### Patch Changes

- [#91](https://github.com/mmurakaru/cueloop/pull/91) [`c632bb0`](https://github.com/mmurakaru/cueloop/commit/c632bb04b3a1ff5896e4fba833c891cca451ada6) Thanks [@mmurakaru](https://github.com/mmurakaru)! - Test hardening: the inline-compose paint assertion waits on the span color instead of sampling the first frame after the keypress, which raced the anchor repaint on slow runners.

- Updated dependencies []:
  - @cueloop/client@0.1.0-alpha.13
  - @cueloop/daemon@0.1.0-alpha.13
  - @cueloop/schema@0.1.0-alpha.13

## 0.1.0-alpha.12

### Minor Changes

- [#89](https://github.com/mmurakaru/cueloop/pull/89) [`5aeeafb`](https://github.com/mmurakaru/cueloop/commit/5aeeafb7986944e15bb8baa5b1cc549482148489) Thanks [@mmurakaru](https://github.com/mmurakaru)! - The client UI is now a reusable component system. Every rendered surface lives in `components/` behind a strict tokens -> primitives -> domain layering, themed through a provider whose default is the built-in dark theme (config themes swap the provider; every component also takes a `theme` prop). Hand-rolled mechanisms were replaced with the documented terminal primitives: native word wrapping (quote anchors stay char-precise), a scrollable uncapped diff view with a real line-number gutter, multiline annotation composers (shift+enter for a new line), tree-sitter code highlighting, tab-strip rail tabs, a select-based verdict picker, suspend/resume around the `$EDITOR` hand-off, and responsive sizing from the terminal dimensions. Key bindings resolve through layered keymaps and the status-line hints are generated from the active bindings, so a rebound key shows its real binding. Each component ships stories; `bun run stories` browses them and the test suite snapshots every story.

### Patch Changes

- Updated dependencies []:
  - @cueloop/client@0.1.0-alpha.12
  - @cueloop/daemon@0.1.0-alpha.12
  - @cueloop/schema@0.1.0-alpha.12

## 0.1.0-alpha.11

### Patch Changes

- [#87](https://github.com/mmurakaru/cueloop/pull/87) [`d445e3b`](https://github.com/mmurakaru/cueloop/commit/d445e3b88ca683d7f940c68ed2564a0bcc0b2fd5) Thanks [@mmurakaru](https://github.com/mmurakaru)! - Upgrade OpenTUI to 0.5.1 (@opentui/core, @opentui/react, @opentui/ssh)

- Updated dependencies []:
  - @cueloop/client@0.1.0-alpha.11
  - @cueloop/daemon@0.1.0-alpha.11
  - @cueloop/schema@0.1.0-alpha.11

## 0.1.0-alpha.10

### Minor Changes

- [#84](https://github.com/mmurakaru/cueloop/pull/84) [`e30a187`](https://github.com/mmurakaru/cueloop/commit/e30a1878965fc2303c5c30ae410cb297de616499) Thanks [@mmurakaru](https://github.com/mmurakaru)! - The submit confirm now lives in the review rail: pressing submit expands the rail's Submit button into a bordered confirm card - honest counts (`N annotations · M blocking`), the Comment / Approve / Changes verdict selector (arrow keys or click), the optional summary input, and plain Submit / Cancel word-buttons - replacing the detached full-width bottom bar. The annotation stack above stays scrollable while the card is open, key hints stay in the status line, read-only observers never see the card, and the keybinding surface is unchanged.

### Patch Changes

- Updated dependencies []:
  - @cueloop/client@0.1.0-alpha.10
  - @cueloop/daemon@0.1.0-alpha.10
  - @cueloop/schema@0.1.0-alpha.10

## 0.1.0-alpha.9

### Minor Changes

- [#80](https://github.com/mmurakaru/cueloop/pull/80) [`40c2f7d`](https://github.com/mmurakaru/cueloop/commit/40c2f7ddb79cdc1e23a4202acce1a04a3fd1b8e0) Thanks [@mmurakaru](https://github.com/mmurakaru)! - Plan review surface v2: selection is the entry primitive (mouse drag or keyboard span on one native renderer selection), the compose box opens inline under the anchor instead of the bottom bar, annotation text lives in the rail while the document keeps only the kind-colored highlight, rail cards edit in place, and exiting the editor hand-off re-anchors every annotation - orphaned ones are flagged in the rail with a one-line reconciliation banner above the sheet.

### Patch Changes

- Updated dependencies []:
  - @cueloop/client@0.1.0-alpha.9
  - @cueloop/daemon@0.1.0-alpha.9
  - @cueloop/schema@0.1.0-alpha.9

## 0.1.0-alpha.8

### Patch Changes

- [#78](https://github.com/mmurakaru/cueloop/pull/78) [`8ee3f3f`](https://github.com/mmurakaru/cueloop/commit/8ee3f3f34dbee98aba1133089ba97253d29fdcec) Thanks [@mmurakaru](https://github.com/mmurakaru)! - The TUI splits into a review-session controller and a pure key reducer. session-controller.ts owns every daemon round-trip and mutation verb - connect/autostart/subscribe, the session/inbox/status snapshot, cut/edit/annotate/submit with both anchor constructions, the notes-vault export, and the post-submit hand-back including the herdr return-focus. keymap.ts turns the keyboard grammar into reduceKey(state, key) -> Intent[]: plan and diff reviews share one path for annotation navigation, deletion, and submit, and the observer read-only rule is one gate instead of three styles. App.tsx keeps only view state (cursor, span, overlays) and rendering; the whole grammar is now unit tested as a key table.

- Updated dependencies []:
  - @cueloop/client@0.1.0-alpha.8
  - @cueloop/daemon@0.1.0-alpha.8
  - @cueloop/schema@0.1.0-alpha.8

## 0.1.0-alpha.7

### Patch Changes

- [#76](https://github.com/mmurakaru/cueloop/pull/76) [`721e267`](https://github.com/mmurakaru/cueloop/commit/721e267dedbd506036d4b6c7e652a790bffc6684) Thanks [@mmurakaru](https://github.com/mmurakaru)! - Annotation ids are unique by construction: a per-process counter joins the time component and the random suffix, so many ids minted on the same millisecond can never collide.

- [#74](https://github.com/mmurakaru/cueloop/pull/74) [`c7615ff`](https://github.com/mmurakaru/cueloop/commit/c7615ff31254e27dd3892d35856f9c48b27a4903) Thanks [@mmurakaru](https://github.com/mmurakaru)! - One shared review core in @cueloop/daemon: openReview resolves the workspace, derives the title from the plan's first heading, and opens-or-revises by agent session id; ReviewHandle.awaitVerdict covers both the single long-poll and the chunked poll loop with progress and abort. The Claude Code hook, the pi extension, and the CLI commands (diff, review, session) now share this one path instead of five hand-built copies; workspace resolution has a single implementation, annotation ids come from one collision-safe helper in @cueloop/schema, and the adapter docs no longer claim a codex adapter that does not exist yet.

- [#72](https://github.com/mmurakaru/cueloop/pull/72) [`74abfb6`](https://github.com/mmurakaru/cueloop/commit/74abfb6bd4b801708f5809ba9e6a0e4e254f9519) Thanks [@mmurakaru](https://github.com/mmurakaru)! - The daemon's wire schemas are now exhaustiveness-checked against the types in @cueloop/schema, so a field added to a type without a matching mirror in the validation layer fails typecheck instead of being silently stripped at the socket boundary. This fixes the hook path dropping `meta.herdrPane` before it reached storage, which left the herdr return-focus feature dead. Round-trip and key-set pin tests guard the boundary at runtime too.

- [#73](https://github.com/mmurakaru/cueloop/pull/73) [`9d38c08`](https://github.com/mmurakaru/cueloop/commit/9d38c08fd96cd5fa3f33a6e4a4c0a6e869e37e10) Thanks [@mmurakaru](https://github.com/mmurakaru)! - Working-copy block surgery moves into schema: cutBlock, restoreBlock, restoreLine, and sourceChunk now live in @cueloop/schema/working-copy, the only module that slices raw source by block line ranges. restoreBlock also owns the pristine round-trip rule (returns undefined when the restore matches the submitted revision), so it is unit tested instead of living in a React callback. Behavior is unchanged.

- Updated dependencies []:
  - @cueloop/client@0.1.0-alpha.7
  - @cueloop/daemon@0.1.0-alpha.7
  - @cueloop/schema@0.1.0-alpha.7

## 0.1.0-alpha.6

### Patch Changes

- [#64](https://github.com/mmurakaru/cueloop/pull/64) [`0b185e1`](https://github.com/mmurakaru/cueloop/commit/0b185e18a322df46a80e10979aa75d4f7f01eba7) Thanks [@mmurakaru](https://github.com/mmurakaru)! - Submitting a review now hands you back to the agent: a completion overlay confirms the verdict (and shows the vault-export path when one ran), offers to close, and can auto-close after a configurable delay - press `a` on the prompt once to opt in (persisted as `[ui] auto_close = 3`), set `0` for instant close, `"off"` to always be asked. `esc` stays in the resolved read-only view.

- [#66](https://github.com/mmurakaru/cueloop/pull/66) [`d38eb6a`](https://github.com/mmurakaru/cueloop/commit/d38eb6a9e5f638e4234119cce967332d20e0dbf0) Thanks [@mmurakaru](https://github.com/mmurakaru)! - First-class herdr hand-back: a review opened beside an agent now returns focus to the agent's pane when it closes. The adapter records the agent's pane on the session, and inside herdr the post-submit overlay defaults to a short countdown ("returning to claude-code") instead of a prompt; CUELOOP_RETURN_PANE overrides the target, and an explicit auto_close config still wins.

- [#68](https://github.com/mmurakaru/cueloop/pull/68) [`7a05add`](https://github.com/mmurakaru/cueloop/commit/7a05add51a38791b15f8599eb7b7e9d0715b78a5) Thanks [@mmurakaru](https://github.com/mmurakaru)! - Code blocks in plans are now readable: lines render verbatim (indentation preserved, never word-wrapped) inside an elevated container with a language tag and tree-sitter syntax highlighting mapped to the theme tokens. Block spacing moved to a top-gap model, so code no longer glues to the list above it and headings always get breathing room.

- [#69](https://github.com/mmurakaru/cueloop/pull/69) [`147bd6c`](https://github.com/mmurakaru/cueloop/commit/147bd6c54e95f83b8bb32be1f1613965812e4cdb) Thanks [@mmurakaru](https://github.com/mmurakaru)! - Code blocks are syntax-highlighted with Shiki: TextMate-grammar tokens colored by a theme built from cueloop's own tokens, sixteen common languages loaded lazily on the first code block, verbatim rendering preserved, and unknown languages degrading to unstyled text.

- Updated dependencies []:
  - @cueloop/client@0.1.0-alpha.6
  - @cueloop/daemon@0.1.0-alpha.6
  - @cueloop/schema@0.1.0-alpha.6

## 0.1.0-alpha.5

### Patch Changes

- [#60](https://github.com/mmurakaru/cueloop/pull/60) [`ef88050`](https://github.com/mmurakaru/cueloop/commit/ef8805035a61606d33426f5eb92c4fbbbbc3f0a1) Thanks [@mmurakaru](https://github.com/mmurakaru)! - Every published package now carries a description, homepage, and issues link, so its npm page explains what it is and links back to the source. The release-integrity check enforces them.

- Updated dependencies []:
  - @cueloop/client@0.1.0-alpha.5
  - @cueloop/daemon@0.1.0-alpha.5
  - @cueloop/schema@0.1.0-alpha.5

## 0.1.0-alpha.4

### Patch Changes

- [#57](https://github.com/mmurakaru/cueloop/pull/57) [`c6d1146`](https://github.com/mmurakaru/cueloop/commit/c6d114654c3b1cde2a943db49c6d54874b4ccfc2) Thanks [@mmurakaru](https://github.com/mmurakaru)! - Document the npm install path (`npm i -g cueloop@alpha`) and stop the release verifier from failing on registry propagation lag: registry assertions now poll until they hold, so a CDN serving a stale document moments after a publish no longer looks like a broken release.

- Updated dependencies []:
  - @cueloop/client@0.1.0-alpha.4
  - @cueloop/daemon@0.1.0-alpha.4
  - @cueloop/schema@0.1.0-alpha.4

## 0.1.0-alpha.3

### Patch Changes

- [#55](https://github.com/mmurakaru/cueloop/pull/55) [`e793005`](https://github.com/mmurakaru/cueloop/commit/e7930051a8f18de016a2d628bf9b232c449ce8fe) Thanks [@mmurakaru](https://github.com/mmurakaru)! - Point the alpha dist-tag at the published release. Prereleases were landing on `latest` while `alpha` kept pointing at the first (broken) publish, so `npm i cueloop@alpha` served the wrong build; the release lane now retags every package and the verification step checks the tag a stranger would install, not just the exact version.

- Updated dependencies []:
  - @cueloop/client@0.1.0-alpha.3
  - @cueloop/daemon@0.1.0-alpha.3
  - @cueloop/schema@0.1.0-alpha.3

## 0.1.0-alpha.2

### Patch Changes

- [#53](https://github.com/mmurakaru/cueloop/pull/53) [`98ff685`](https://github.com/mmurakaru/cueloop/commit/98ff6850c7042cd369174140382939e2a9ab1e76) Thanks [@mmurakaru](https://github.com/mmurakaru)! - Read tarball contents from the archive itself during the publish check, instead of trusting `npm pack --json` whose output shape differs between npm majors.

- Updated dependencies []:
  - @cueloop/client@0.1.0-alpha.2
  - @cueloop/daemon@0.1.0-alpha.2
  - @cueloop/schema@0.1.0-alpha.2

## 0.1.0-alpha.1

### Patch Changes

- [#50](https://github.com/mmurakaru/cueloop/pull/50) [`ebe744e`](https://github.com/mmurakaru/cueloop/commit/ebe744ed629ff60c149ef630258dbd7d854919ed) Thanks [@mmurakaru](https://github.com/mmurakaru)! - Published tarballs now carry resolvable dependency ranges. Internal dependencies were shipped as `workspace:*`, a package-manager protocol no npm client can resolve, so installing the published CLI failed. The version step now pins internal dependencies to the concrete lockstep version, and a pre-publish check packs every package and rejects unresolvable protocols or missing entry points.

- [#52](https://github.com/mmurakaru/cueloop/pull/52) [`b65a75f`](https://github.com/mmurakaru/cueloop/commit/b65a75f5f8af73be7d105d6e1415d51dd0cf1b94) Thanks [@mmurakaru](https://github.com/mmurakaru)! - The release lane now verifies the published result: every package must be on the registry at the released version, and the CLI must install from npm and run. A publish that reports success but leaves something unusable fails the release run instead of reaching users.

- Updated dependencies []:
  - @cueloop/client@0.1.0-alpha.1
  - @cueloop/daemon@0.1.0-alpha.1
  - @cueloop/schema@0.1.0-alpha.1

## 0.1.0-alpha.0

### Minor Changes

- [#44](https://github.com/mmurakaru/cueloop/pull/44) [`2da6efb`](https://github.com/mmurakaru/cueloop/commit/2da6efb4cc72adae56927a42d7981ebdaf09049a) Thanks [@mmurakaru](https://github.com/mmurakaru)! - First alpha of the terminal review surface: the ReviewSession primitive end to end - plan review round-trip with Claude Code (annotate, span-select, Cut, $EDITOR edits, verdict + feedback.md), working-tree diff review, the inbox, a lazy unix-socket daemon with resumable waits, the typed extension API with trusted repo loading, layered TOML config with rebindable keys, and the Claude Code plugin packaging (/cueloop:plan, /cueloop:diff, /cueloop:review).

### Patch Changes

- [#46](https://github.com/mmurakaru/cueloop/pull/46) [`c060cac`](https://github.com/mmurakaru/cueloop/commit/c060cac0381d0e1c238fde064071654a0ac8e0e4) Thanks [@mmurakaru](https://github.com/mmurakaru)! - Guarantee one daemon per state directory. Concurrent autostarts previously raced: the second daemon unlinked the first one's socket and bound a fresh one, so two daemons served divergent in-memory sessions over the same files and a client could stop seeing sessions another had just created. Startup now takes an exclusive lock, a losing start exits quietly so the caller attaches to the live daemon, and stale locks from crashed daemons are reclaimed.

- [#45](https://github.com/mmurakaru/cueloop/pull/45) [`2bc1e3d`](https://github.com/mmurakaru/cueloop/commit/2bc1e3d9d7bedc0aaec77b030ab5a3cdb563f371) Thanks [@mmurakaru](https://github.com/mmurakaru)! - Make the end-to-end suite deadline-based instead of iteration-based, so a cold CI runner paying for a subprocess and daemon start is not mistaken for a failure.

- [#39](https://github.com/mmurakaru/cueloop/pull/39) [`782a5d3`](https://github.com/mmurakaru/cueloop/commit/782a5d3f3552f81bda6f06bdd4b3bdb1193bc072) Thanks [@mmurakaru](https://github.com/mmurakaru)! - herdr tier-1 integration: panes report blocked/working state and review labels through the env contract; silent outside herdr.

- [#45](https://github.com/mmurakaru/cueloop/pull/45) [`2bc1e3d`](https://github.com/mmurakaru/cueloop/commit/2bc1e3d9d7bedc0aaec77b030ab5a3cdb563f371) Thanks [@mmurakaru](https://github.com/mmurakaru)! - An adapter failure can no longer wedge the agent: whatever goes wrong inside cueloop, the hook emits a valid response carrying the reason instead of dying silently. Daemon autostart also waits longer (and reports why it gave up) so a cold or loaded machine is not mistaken for a broken daemon.

- [#42](https://github.com/mmurakaru/cueloop/pull/42) [`2d3ef3d`](https://github.com/mmurakaru/cueloop/commit/2d3ef3d4cea88f42d1fef9d6e719df51fb95c866) Thanks [@mmurakaru](https://github.com/mmurakaru)! - Obsidian vault export: auto-detected vaults, filename templates with collision handling, provenance frontmatter, export on approve/resolve/manual.

- [#40](https://github.com/mmurakaru/cueloop/pull/40) [`5abf5e7`](https://github.com/mmurakaru/cueloop/commit/5abf5e7dfbbfd37018fb013a009d4bc6e914e55e) Thanks [@mmurakaru](https://github.com/mmurakaru)! - pi adapter: request_review tool blocking in-turn on the verdict with live progress, a pending-review write gate, and a /review command.

- [#38](https://github.com/mmurakaru/cueloop/pull/38) [`ec5005f`](https://github.com/mmurakaru/cueloop/commit/ec5005f28757c17ac74b277dff027ad875dfbe37) Thanks [@mmurakaru](https://github.com/mmurakaru)! - cueloop review <pr>: fetch a pull request via gh into a diff session and post the verdict back as a real PR review; adds --no-tui and review-post for scripting.

- [#41](https://github.com/mmurakaru/cueloop/pull/41) [`4c83286`](https://github.com/mmurakaru/cueloop/commit/4c83286406ad543261caa15f39594fe317e175c8) Thanks [@mmurakaru](https://github.com/mmurakaru)! - PTY test tier: the real TUI driven in a pseudo-terminal (render, key routing, resize, clean exit), env-gated.

- [#43](https://github.com/mmurakaru/cueloop/pull/43) [`d34cc68`](https://github.com/mmurakaru/cueloop/commit/d34cc68270daee8e9395feecd6cb64988f283f07) Thanks [@mmurakaru](https://github.com/mmurakaru)! - cueloop serve: share a session over SSH with read-only observers; the local TUI stays the single writable controller.

- [#45](https://github.com/mmurakaru/cueloop/pull/45) [`2bc1e3d`](https://github.com/mmurakaru/cueloop/commit/2bc1e3d9d7bedc0aaec77b030ab5a3cdb563f371) Thanks [@mmurakaru](https://github.com/mmurakaru)! - Validate the daemon's socket boundary with valibot: every request is checked before it reaches the session core, malformed input gets an `invalid_params` error naming the offending field, wait timeouts are clamped, and persisted session records are validated on recovery. Verdict kinds are closed; annotation kinds stay open for extensions.

- Updated dependencies []:
  - @cueloop/client@0.1.0-alpha.0
  - @cueloop/daemon@0.1.0-alpha.0
  - @cueloop/schema@0.1.0-alpha.0
