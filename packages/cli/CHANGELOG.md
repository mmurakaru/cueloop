# cueloop

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
