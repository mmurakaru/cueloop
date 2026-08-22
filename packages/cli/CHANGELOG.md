# cueloop

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
