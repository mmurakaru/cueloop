# cueloop

## 0.1.0-alpha.87

### Patch Changes

- [#514](https://github.com/mmurakaru/cueloop/pull/514) [`8a8c8a6`](https://github.com/mmurakaru/cueloop/commit/8a8c8a65be5932591ebe655e695ed2bf3031a722) Thanks [@mmurakaru](https://github.com/mmurakaru)! - Keep Thread send-message instructions out of GitHub review bodies and wait for CLI-created PR reviews in the review skill.
- Updated dependencies []:
  - @cueloop/adapters@0.1.0-alpha.87
  - @cueloop/client@0.1.0-alpha.87
  - @cueloop/daemon@0.1.0-alpha.87
  - @cueloop/schema@0.1.0-alpha.87

## 0.1.0-alpha.86

### Minor Changes

- [#511](https://github.com/mmurakaru/cueloop/pull/511) [`5881bb2`](https://github.com/mmurakaru/cueloop/commit/5881bb28f35b0eba32495b625e233ff0615d73e4) Thanks [@mmurakaru](https://github.com/mmurakaru)! - Add an agent-driven pull-request review workflow with configurable skills and workspaces, line-anchored findings, explicit GitHub publishing, PR refresh state, and self-hosted severity badges.

  Keep the welcome screen version tied to the published client package.

### Patch Changes

- Updated dependencies [[`5881bb2`](https://github.com/mmurakaru/cueloop/commit/5881bb28f35b0eba32495b625e233ff0615d73e4)]:
  - @cueloop/schema@0.1.0-alpha.86
  - @cueloop/daemon@0.1.0-alpha.86
  - @cueloop/adapters@0.1.0-alpha.86
  - @cueloop/client@0.1.0-alpha.86

## 0.1.0-alpha.85

### Minor Changes

- [#508](https://github.com/mmurakaru/cueloop/pull/508) [`e86e4de`](https://github.com/mmurakaru/cueloop/commit/e86e4de84b175b73e252240e6d814eb7f2d4fbad) Thanks [@mmurakaru](https://github.com/mmurakaru)! - Publish agent-readable website resources and a read-only discovery API.

### Patch Changes

- Updated dependencies []:
  - @cueloop/adapters@0.1.0-alpha.85
  - @cueloop/client@0.1.0-alpha.85
  - @cueloop/daemon@0.1.0-alpha.85
  - @cueloop/schema@0.1.0-alpha.85

## 0.1.0-alpha.84

### Minor Changes

- [#505](https://github.com/mmurakaru/cueloop/pull/505) [`b5f43e5`](https://github.com/mmurakaru/cueloop/commit/b5f43e5adaa95275420e474281c122826ad91acb) Thanks [@mmurakaru](https://github.com/mmurakaru)! - Add non-resolving Comment messages and exact character Cut/restore behavior.

  Keep held marks moving at viewport edges, preserve their visual column across
  vertical keyboard movement, center empty project panels, and remove success
  toasts from edit actions. Point pi version mismatches at its extension update
  command and streamline the installation, harness, Thread, and sharing docs.

### Patch Changes

- Updated dependencies [[`b5f43e5`](https://github.com/mmurakaru/cueloop/commit/b5f43e5adaa95275420e474281c122826ad91acb), [`fe05241`](https://github.com/mmurakaru/cueloop/commit/fe05241a69753e7b32e01d406779435d1e8a95c3)]:
  - @cueloop/schema@0.1.0-alpha.84
  - @cueloop/client@0.1.0-alpha.84
  - @cueloop/daemon@0.1.0-alpha.84
  - @cueloop/adapters@0.1.0-alpha.84

## 0.1.0-alpha.83

### Patch Changes

- [#501](https://github.com/mmurakaru/cueloop/pull/501) [`c36e1fb`](https://github.com/mmurakaru/cueloop/commit/c36e1fbe5eea7f9f3f5f0bc444cf2d39e2d1ec57) Thanks [@mmurakaru](https://github.com/mmurakaru)! - Keep ordinary Claude Code tools available when the Mod or cueloop bridge is unavailable, and remove the unconditional command hook that blocked every tool call.
  Keep a live daemon running when an installed adapter uses a different cueloop version.
- Updated dependencies []:
  - @cueloop/adapters@0.1.0-alpha.83
  - @cueloop/client@0.1.0-alpha.83
  - @cueloop/daemon@0.1.0-alpha.83
  - @cueloop/schema@0.1.0-alpha.83

## 0.1.0-alpha.82

### Patch Changes

- [#498](https://github.com/mmurakaru/cueloop/pull/498) [`078b3ab`](https://github.com/mmurakaru/cueloop/commit/078b3abb0fe5e77f79e3c87c5d3f07a6be9ddd22) Thanks [@mmurakaru](https://github.com/mmurakaru)! - Reduce standalone CLI startup time by minifying its binary.
- Updated dependencies []:
  - @cueloop/adapters@0.1.0-alpha.82
  - @cueloop/client@0.1.0-alpha.82
  - @cueloop/daemon@0.1.0-alpha.82
  - @cueloop/schema@0.1.0-alpha.82

## 0.1.0-alpha.81

### Minor Changes

- [#493](https://github.com/mmurakaru/cueloop/pull/493) [`6211a3e`](https://github.com/mmurakaru/cueloop/commit/6211a3eca3cea3f33fea24d3018fe0ca1f31f761) Thanks [@mmurakaru](https://github.com/mmurakaru)! - Use a Claude Mod on Claude Code 2.1.278 or newer for native Thread gating and Message injection. Move shared workflow operations behind the cueloop harness bridge and remove the legacy review hook, private inbox, and detached Claude waiter. A guard blocks tools when the Mod is unavailable.

- [#494](https://github.com/mmurakaru/cueloop/pull/494) [`755ec8d`](https://github.com/mmurakaru/cueloop/commit/755ec8dea8947da599de16a35e211be2c9533f27) Thanks [@mmurakaru](https://github.com/mmurakaru)! - Ship a portable Codex plugin with shared Thread workflows, native session binding, and durable Message delivery through the long-lived MCP process.

- [#491](https://github.com/mmurakaru/cueloop/pull/491) [`915df76`](https://github.com/mmurakaru/cueloop/commit/915df76f5d8b2736f9f864d0897f69884ddb108e) Thanks [@mmurakaru](https://github.com/mmurakaru)! - Open pending Threads in Ghostty tabs, right-hand panes, or windows through its
  macOS AppleScript API. Reuse live terminals, reopen closed ones, and fall back to
  the manual command when automation fails.

- [#489](https://github.com/mmurakaru/cueloop/pull/489) [`bb458ce`](https://github.com/mmurakaru/cueloop/commit/bb458ce72b5308067371555587bca26ebc23ee80) Thanks [@mmurakaru](https://github.com/mmurakaru)! - Open pending Threads in a focused Herdr tab or a 50 percent right-hand pane,
  selected through personal config. Reuse live surfaces, reopen closed ones, and
  return a manual open command when terminal automation fails.

### Patch Changes

- Updated dependencies [[`6211a3e`](https://github.com/mmurakaru/cueloop/commit/6211a3eca3cea3f33fea24d3018fe0ca1f31f761), [`755ec8d`](https://github.com/mmurakaru/cueloop/commit/755ec8dea8947da599de16a35e211be2c9533f27), [`5b0a8ec`](https://github.com/mmurakaru/cueloop/commit/5b0a8ecb3a0ee730e54853525c6b8ff0a66770fa)]:
  - @cueloop/adapters@0.1.0-alpha.81
  - @cueloop/daemon@0.1.0-alpha.81
  - @cueloop/client@0.1.0-alpha.81
  - @cueloop/schema@0.1.0-alpha.81

## 0.1.0-alpha.80

### Minor Changes

- [#487](https://github.com/mmurakaru/cueloop/pull/487) [`bdf6d30`](https://github.com/mmurakaru/cueloop/commit/bdf6d303f03cbedb02d50dea84a95105a9758c26) Thanks [@mmurakaru](https://github.com/mmurakaru)! - Add one shared Thread workflow contract for plan, reply, prototype, diff, review,
  and refine. Review imports and posts PR Messages through a shared forge port;
  refine shares corpus analysis with the CLI. Shared skills leave native message
  delivery to each harness adapter.

- [#487](https://github.com/mmurakaru/cueloop/pull/487) [`bdf6d30`](https://github.com/mmurakaru/cueloop/commit/bdf6d303f03cbedb02d50dea84a95105a9758c26) Thanks [@mmurakaru](https://github.com/mmurakaru)! - Add durable harness bindings and Message delivery for Threads. The daemon and
  CLI now send stable-ID Messages with `approved` or `changes_requested` outcomes,
  and harness adapters can redeliver safely until native injection is acknowledged.
  An unchanged approved plan has one persisted retry, and adapter Message IDs are
  journaled across reloads.
  The TUI uses `Send message (n)`, and active code and commands use Thread and
  Message names without the pre-alpha decision aliases.

### Patch Changes

- Updated dependencies []:
  - @cueloop/adapters@0.1.0-alpha.80
  - @cueloop/client@0.1.0-alpha.80
  - @cueloop/daemon@0.1.0-alpha.80
  - @cueloop/schema@0.1.0-alpha.80

## 0.1.0-alpha.79

### Minor Changes

- [#469](https://github.com/mmurakaru/cueloop/pull/469) [`47b873e`](https://github.com/mmurakaru/cueloop/commit/47b873e1d7adbaaba7992aa15c5cd475e3fe51b5) Thanks [@mmurakaru](https://github.com/mmurakaru)! - Reach the thread's structural commands through a nav mode instead of a leader chord. In the thread you type to comment, as before; press esc for nav mode - the footer switches to the commands - and a bare letter runs one: e edit, s share, enter submit, n/p move between comments, x cut, u restore, r rename, and the diff and tree letters. Every command is a bare key with no prefix and no modifier, so the terminal never swallows one and there is nothing to set up. Tab and shift+tab cycle the panes. The old ctrl+g leader is gone; cmd/ctrl+enter, ctrl+e, and ctrl+s stay as accelerators.

  The mode hint is one line above the focused surface's footer, a diff rejects a change with a single x, and the submit card opens on approve by default (set `[ui] default_verdict` to change it). The inline plan editor keeps the pane's left inset and saves with ctrl+enter. A focused comment fills its marker-rail dot, not just the card border. The unwired tree-view toggle is dropped from nav until the history view lands. The nav footer names only the commands the surface can run, so the Welcome tab and a project file offer comment and fold rather than the diff commands. The keybinds dialog no longer lists an agent terminal detach chord, which had nothing behind it.

### Patch Changes

- [#466](https://github.com/mmurakaru/cueloop/pull/466) [`8a38a25`](https://github.com/mmurakaru/cueloop/commit/8a38a2537ea930b672519eaf1eed09b9523d0a82) Thanks [@mmurakaru](https://github.com/mmurakaru)! - The Changes pane's "No changes" hint centers level with the thread pane's "Select a thread", offsetting for the thread footer's height.

- [#468](https://github.com/mmurakaru/cueloop/pull/468) [`f796fef`](https://github.com/mmurakaru/cueloop/commit/f796fefa3d495d95e55f5e4dcf72326819f59945) Thanks [@mmurakaru](https://github.com/mmurakaru)! - Edit a thread's body inline, without leaving the pane. The edit shortcut now opens a native markdown editor over the thread - full editor motion, selection, and undo - that lightly marks the source as you type: a heading's marker dims and its title bolds, links color, and inline and fenced code gray. The header action toggles between edit and normal; cmd, meta, or ctrl + enter saves and closes. A diff still hands off to your `$EDITOR`.

- [#468](https://github.com/mmurakaru/cueloop/pull/468) [`f796fef`](https://github.com/mmurakaru/cueloop/commit/f796fefa3d495d95e55f5e4dcf72326819f59945) Thanks [@mmurakaru](https://github.com/mmurakaru)! - Render a thread's plan the way a markdown preview does. Headings sit over a rule, links show their label in the link color with the URL tucked away, inline and fenced code gray, and emphasis reads bold, italic, or struck - the source markers are gone. GFM tables render as an aligned grid and leading YAML frontmatter as a bordered key/value table. Comments still anchor to the source under the rendered text, so a note dropped on a link label lands exactly where it reads.
- Updated dependencies []:
  - @cueloop/adapters@0.1.0-alpha.79
  - @cueloop/client@0.1.0-alpha.79
  - @cueloop/daemon@0.1.0-alpha.79
  - @cueloop/schema@0.1.0-alpha.79

## 0.1.0-alpha.78

### Patch Changes

- [#462](https://github.com/mmurakaru/cueloop/pull/462) [`123b3e7`](https://github.com/mmurakaru/cueloop/commit/123b3e780c4a7d0fb41e055ef2c3c045df2c2c0a) Thanks [@mmurakaru](https://github.com/mmurakaru)! - The send-message summary is now the same composer as inline comments: enter breaks the line, cmd or ctrl and enter sends, and typing a slash opens the same actions-and-skills palette. A pasted image collapses to a numbered placeholder instead of dumping raw bytes into the draft, in both the summary and inline comments. A returning collaborator is no longer re-prompted to connect GitHub for a share they already joined. The join-splash logo is aligned to match the install script.

- [#462](https://github.com/mmurakaru/cueloop/pull/462) [`7ed5a43`](https://github.com/mmurakaru/cueloop/commit/7ed5a436351cd8079a63c20b033bb20cc6c47272) Thanks [@mmurakaru](https://github.com/mmurakaru)! - Navigating between threads is now instant, even with many projects and large reviews open. Opening a diff no longer word-diffs every line of the whole file up front - only the lines on screen - and opening or switching to a plan no longer builds every block before the first frame, just the ones in view. Under a worst-case load (several projects, large annotated plans, big diffs) the click-to-first-byte drops from about 108ms to about 21ms for a diff and from about 57ms to about 28ms for a plan.

- [#462](https://github.com/mmurakaru/cueloop/pull/462) [`5cf9149`](https://github.com/mmurakaru/cueloop/commit/5cf9149ad5555a63ddb1e902808b5f7c5f176647) Thanks [@mmurakaru](https://github.com/mmurakaru)! - Faster launch and navigation, and fix a freeze on stale annotations. A stale multi-block annotation no longer freezes the review while its quote is re-matched (the fuzzy search now shares one work budget across an anchor's blocks instead of spending it per block; a 160-block plan drops from ~16s to ~0.3s). The first frame paints before the terminal's theme query instead of after it (cold launch ~320ms to ~257ms). A session update that only changed annotations or status now reuses the parsed document projection instead of re-parsing the whole document. A saved comment paints immediately instead of blinking out until the daemon write returns.

- [#462](https://github.com/mmurakaru/cueloop/pull/462) [`a81ae19`](https://github.com/mmurakaru/cueloop/commit/a81ae19ed46f12f03c98ad9478b1d37524ac0b5b) Thanks [@mmurakaru](https://github.com/mmurakaru)! - The threads sidebar is cleaner: no star or folder glyphs, and it cascades by nesting so a project's threads sit indented under the project name. Transient notices lose their stray "[esc]" hint, and the redundant "annotation updated" status is gone.

- [#462](https://github.com/mmurakaru/cueloop/pull/462) [`807b9c8`](https://github.com/mmurakaru/cueloop/commit/807b9c8c8f4307f483e7beac485f7c70ed540f21) Thanks [@mmurakaru](https://github.com/mmurakaru)! - The primitive is now called a thread everywhere - the UI strings, the docs, and the concepts page - matching how it is used; the wire and CLI vocabulary is unchanged. The GitHub connect screens over SSH also read better: they show the short link and the code to type (GitHub no longer prefills it), align cleanly, wrap without clipping, and the data-use line no longer overstates what is kept.

- [#462](https://github.com/mmurakaru/cueloop/pull/462) [`6f6d935`](https://github.com/mmurakaru/cueloop/commit/6f6d935ff240b61e6f35760321f61db2811a9b50) Thanks [@mmurakaru](https://github.com/mmurakaru)! - Switching between threads is faster. A recently-viewed thread keeps its parsed projection in a small per-thread cache, so returning to it reuses the work instead of re-parsing the diff or plan. A changed file's model is parsed on first curation touch rather than for every file when a diff opens, which the virtualized diff view never needed up front. Opening a large diff is about a fifth faster at the p95 and returns to it are cheaper.

- [#462](https://github.com/mmurakaru/cueloop/pull/462) [`fade841`](https://github.com/mmurakaru/cueloop/commit/fade841e18837d920e858c0a46748540aad37826) Thanks [@mmurakaru](https://github.com/mmurakaru)! - Overlays now share one language. Confirm, rename, submit, delete, the guided-walk end card, share, manage-access, and the completion screen all use the same lowercase word-buttons on an accent frame, instead of a mix of clickable text, key-hint captions, and bracketed labels. Keys still work; the keybinds sheet remains where they are documented.
- Updated dependencies []:
  - @cueloop/adapters@0.1.0-alpha.78
  - @cueloop/client@0.1.0-alpha.78
  - @cueloop/daemon@0.1.0-alpha.78
  - @cueloop/schema@0.1.0-alpha.78

## 0.1.0-alpha.77

### Minor Changes

- [#454](https://github.com/mmurakaru/cueloop/pull/454) [`9155958`](https://github.com/mmurakaru/cueloop/commit/9155958290a6728871bf80419ab558d079533ecc) Thanks [@mmurakaru](https://github.com/mmurakaru)! - Collaborators can connect GitHub when they open a shared review: a join splash then a connect screen run GitHub's device flow, and the verified login signs their comments with a recognizable name. Connecting is optional - escape stays anonymous - and the token is discarded after one identity lookup.

- [#460](https://github.com/mmurakaru/cueloop/pull/460) [`bdd09aa`](https://github.com/mmurakaru/cueloop/commit/bdd09aa60212f54205ce67e7c0b46e0f49e56d2d) Thanks [@mmurakaru](https://github.com/mmurakaru)! - The gateway now enforces the private-share allowlist: a private share renders only for a collaborator who authenticated a GitHub identity and whose verified login is on the allowlist (matched case-insensitively). Anyone else is refused before the shared view opens. Public shares are unchanged.

- [#459](https://github.com/mmurakaru/cueloop/pull/459) [`d663f4c`](https://github.com/mmurakaru/cueloop/commit/d663f4cb88c771e20ed24f064e5960adb33e064a) Thanks [@mmurakaru](https://github.com/mmurakaru)! - A private share now carries an owner-managed allowlist of GitHub logins. The share popover's private option opens a manage-access surface where the owner adds and removes GitHub handles; the list persists with the thread and is editable after the link is created.

- [#451](https://github.com/mmurakaru/cueloop/pull/451) [`d5950dd`](https://github.com/mmurakaru/cueloop/commit/d5950dd7f21a9f92f1b8965d7b4213cb1c98a947) Thanks [@mmurakaru](https://github.com/mmurakaru)! - Reviewer identity: an Account settings tab shows your display name and syncs it from your signed-in GitHub account with no prompt, and hovering a comment's author dot shows who wrote it.

- [#461](https://github.com/mmurakaru/cueloop/pull/461) [`0f3a0e8`](https://github.com/mmurakaru/cueloop/commit/0f3a0e8fe640a13119c91949132eadb66569ca19) Thanks [@mmurakaru](https://github.com/mmurakaru)! - Reach the share public/private choice from the keyboard in any view. The share shortcut opens an app-level choice overlay - public publishes a link for anyone, private opens the manage-access allowlist - and the header share button opens the same surface, so a keyboard user in the working-tree diff gets the private option that used to live only in the header popover.

- [#455](https://github.com/mmurakaru/cueloop/pull/455) [`38c5b6b`](https://github.com/mmurakaru/cueloop/commit/38c5b6bf1c6d07fc2f9c79926c2130e00e2dc289) Thanks [@mmurakaru](https://github.com/mmurakaru)! - Share now opens a popover to choose a public link (open to anyone with the link) or a private link (invite by identity). The public choice publishes and copies the connection line as before.

### Patch Changes

- Updated dependencies []:
  - @cueloop/adapters@0.1.0-alpha.77
  - @cueloop/client@0.1.0-alpha.77
  - @cueloop/daemon@0.1.0-alpha.77
  - @cueloop/schema@0.1.0-alpha.77

## 0.1.0-alpha.76

### Minor Changes

- [#439](https://github.com/mmurakaru/cueloop/pull/439) [`3e217f2`](https://github.com/mmurakaru/cueloop/commit/3e217f257363eed9ea695bcc470117d8a65a7ad5) Thanks [@mmurakaru](https://github.com/mmurakaru)! - The workbench now has a unified pane focus model: exactly one of Threads, Thread, Changes, or Project owns the keyboard, shown by a selected-item backdrop that moves with the arrow keys or `j`/`k` and opens with Enter or Tab. Sidebar navigation no longer moves the caret in the open thread. A rebindable command leader reaches structural commands, and the leader then Tab cycles focus between panes. The project tree and the changed-files tree navigate by keyboard when focused, and the editor split control is a floating popover you drive with the arrow keys. Menus are single-open, so opening one closes any other. Rounding out the pass: the pinned sidebar section is now Starred, dialogs capture focus on open and dismiss on an outside click, empty states are centered, the footer branch truncates rather than wraps, and the pointer no longer sticks in text selection after the terminal drops mouse reporting.

### Patch Changes

- [#442](https://github.com/mmurakaru/cueloop/pull/442) [`40751af`](https://github.com/mmurakaru/cueloop/commit/40751afea30f6446a3b6abb5ac8cc26780a466af) Thanks [@mmurakaru](https://github.com/mmurakaru)! - The diff view opens changed files faster. Its intra-line word-diff cached the per-line word set instead of recomputing it for every comparison in the line-matching grid, cutting the work of rendering a multi-line change block.

- [#442](https://github.com/mmurakaru/cueloop/pull/442) [`4c1ca0a`](https://github.com/mmurakaru/cueloop/commit/4c1ca0ae2d2a300330d835269b32ca16f70412c6) Thanks [@mmurakaru](https://github.com/mmurakaru)! - cueloop launches faster. The terminal background-color query that runs at startup now waits at most 100ms instead of 200ms before falling back to the dark theme, so a terminal that does not answer the query no longer stalls the launch.
- Updated dependencies []:
  - @cueloop/adapters@0.1.0-alpha.76
  - @cueloop/client@0.1.0-alpha.76
  - @cueloop/daemon@0.1.0-alpha.76
  - @cueloop/schema@0.1.0-alpha.76

## 0.1.0-alpha.75

### Patch Changes

- [#435](https://github.com/mmurakaru/cueloop/pull/435) [`32fc60a`](https://github.com/mmurakaru/cueloop/commit/32fc60a73473004feee1fc8119d80b8356354b63) Thanks [@mmurakaru](https://github.com/mmurakaru)! - `cueloop update` and the curl installer now resolve the right release when the GitHub releases API is returned as minified (single-line) JSON, as some corporate proxies do. `resolve_tag` matched the CLI's own `cueloop@` tags but then extracted the version with a greedy `sed`, which on single-line JSON skipped past every tag to the oldest scoped package tag on the page (`@cueloop/schema@...`) and 404ed on its missing binary. It now takes the first matching CLI tag regardless of whitespace, so the newest `cueloop@` release is chosen either way.
- Updated dependencies []:
  - @cueloop/adapters@0.1.0-alpha.75
  - @cueloop/client@0.1.0-alpha.75
  - @cueloop/daemon@0.1.0-alpha.75
  - @cueloop/schema@0.1.0-alpha.75

## 0.1.0-alpha.74

### Minor Changes

- [#431](https://github.com/mmurakaru/cueloop/pull/431) [`28a4a7d`](https://github.com/mmurakaru/cueloop/commit/28a4a7d62ef6978f2e37f7c609284efc48e7b227) Thanks [@mmurakaru](https://github.com/mmurakaru)! - The Changes panel now renders a file's working-tree diff on a bare `cueloop` launch, before any thread exists. Clicking a changed file in the Changes tree opens its diff (red/green for a modified file, all-additions for a new one) instead of read-only contents; the Project tree still opens contents. The first comment on a bare-launch diff promotes the per-repo workbench thread and anchors the note, as before. The diff renderer (`GridTabContent`) is shared between the thread workbench and the bare-launch shell so a changed file looks and behaves the same in both.

- [#433](https://github.com/mmurakaru/cueloop/pull/433) [`ade7710`](https://github.com/mmurakaru/cueloop/commit/ade77108a7da6b386a8987038a8968616ccb41ad) Thanks [@mmurakaru](https://github.com/mmurakaru)! - `cueloop diff` now opens the per-repo workbench instead of pinning a standalone diff sheet. It find-or-creates the repo's workbench thread (the same one a bare launch creates on its first comment) and opens it in the review layout - changes panel zoomed, changes tab active - so it is annotatable right away. The Changes tab renders the live working tree, so re-running `cueloop diff` after more edits shows the current diff and reuses the same thread rather than spawning a new one. The workbench thread stays a pure annotation container: a diff review still pins its captured patch, but a workbench thread reflects the live tree.

- [#432](https://github.com/mmurakaru/cueloop/pull/432) [`c3d861f`](https://github.com/mmurakaru/cueloop/commit/c3d861f94569e27a2d0d65511a99ebcf63551ab9) Thanks [@mmurakaru](https://github.com/mmurakaru)! - Each launch opens in a pane layout chosen by how it started. `cueloop diff` and `cueloop review` open the Changes diff zoomed and front-and-centre; `cueloop plan` and `cueloop reply` fill the middle with the thread pane and close the right region. A bare `cueloop` remembers the last layout you left, restoring which sidebars were open and whether the Changes panel was zoomed, and falls back to the inbox with the diff zoomed on first run. Opening a specific thread by id keeps letting that thread drive its own panes. The remembered layout persists to `[ui] layout` in the config.

- [#434](https://github.com/mmurakaru/cueloop/pull/434) [`6bd2b39`](https://github.com/mmurakaru/cueloop/commit/6bd2b39814cd243fdad5dafc8c48a06efaa84c19) Thanks [@mmurakaru](https://github.com/mmurakaru)! - Sharing or serving a workbench thread now freezes a snapshot of the working-tree diff for the remote reviewer, who cannot see your tree. `cueloop share` pins the current diff into the shared artifact (and drops the workbench marker) so the link stays stable no matter how you edit on; `cueloop serve` captures the diff once at serve time and splices it into what each observer reads, while their annotations and the rest of the thread stay live. Your own local session keeps rendering the live working tree.

### Patch Changes

- [#429](https://github.com/mmurakaru/cueloop/pull/429) [`0f082ba`](https://github.com/mmurakaru/cueloop/commit/0f082ba68ad9021a715ce58d6494a970805f2b64) Thanks [@mmurakaru](https://github.com/mmurakaru)! - A batch of TUI refinements:

  - The collapsed-sidebar thread header keeps the gear, the Threads toggle, and the "cueloop" mark on one line; a long title tails off in an ellipsis instead of wrapping the brand onto the underline row. The right-sidebar tooltip reads "Toggle Sidebar".
  - The sidebar thread list clips long titles with an ellipsis rather than a gradient fade.
  - The Settings dialog nav lists General, Appearance, Actions, and Keybinds as first-level entries; the redundant "Settings" group header is gone.
  - The Actions editor makes both the action title and its system prompt editable.
  - The verdict card drops its "send message" border title (the send button already says it).
  - Every overlay uses square corners instead of rounded.

- Updated dependencies []:
  - @cueloop/adapters@0.1.0-alpha.74
  - @cueloop/client@0.1.0-alpha.74
  - @cueloop/daemon@0.1.0-alpha.74
  - @cueloop/schema@0.1.0-alpha.74

## 0.1.0-alpha.73

### Minor Changes

- [#423](https://github.com/mmurakaru/cueloop/pull/423) [`0f3d4f7`](https://github.com/mmurakaru/cueloop/commit/0f3d4f706dcb97823df4e1386202c1de51739931) Thanks [@mmurakaru](https://github.com/mmurakaru)! - Added `cueloop stop` and `cueloop restart` to control the local daemon, and `cueloop update` now stops the running daemon after installing a newer build. The daemon refuses cross-version connections, so a client left talking to a stale daemon fails with "not connected" when it tries to comment; self-healing on update, plus an explicit `restart`, clears that without a manual process kill. `stop` prefers the owner-gated shutdown request and falls back to signalling the daemon's pid when a version-mismatched daemon refuses the handshake.

### Patch Changes

- [#421](https://github.com/mmurakaru/cueloop/pull/421) [`8a60c4f`](https://github.com/mmurakaru/cueloop/commit/8a60c4f4cdcf1592efaa29e9d76eeb8ebf2081c6) Thanks [@mmurakaru](https://github.com/mmurakaru)! - `cueloop update` now prints its progress (current version, checking, updating, restart notice) to stdout instead of stderr, so ordinary status no longer shows up as red error text in terminals that color stderr. Genuine failures still go to stderr.
- Updated dependencies []:
  - @cueloop/adapters@0.1.0-alpha.73
  - @cueloop/client@0.1.0-alpha.73
  - @cueloop/daemon@0.1.0-alpha.73
  - @cueloop/schema@0.1.0-alpha.73

## 0.1.0-alpha.72

### Patch Changes

- [#413](https://github.com/mmurakaru/cueloop/pull/413) [`cf72af0`](https://github.com/mmurakaru/cueloop/commit/cf72af0274a127424fc9b58acbe7cdd634cb0d8b) Thanks [@mmurakaru](https://github.com/mmurakaru)! - The comment composer no longer reorders characters that arrive faster than it settles: a fast paste, key repeat, or automation used to scramble the draft (e.g. "needs a test" became "anee testds"). The textarea now claims input synchronously at mount, so every character lands in the order it was typed, and a whole-string paste opens a draft with the full text.

  The "/" palette reopens for each "/word" the caret writes, so several actions or skills chain in one comment with prose between them. A completed "/name" reference paints in the accent color in every composer - the plan thread, the diff sheet, and the prototype - through one shared palette context.

- Updated dependencies []:
  - @cueloop/adapters@0.1.0-alpha.72
  - @cueloop/client@0.1.0-alpha.72
  - @cueloop/daemon@0.1.0-alpha.72
  - @cueloop/schema@0.1.0-alpha.72

## 0.1.0-alpha.71

### Patch Changes

- [#411](https://github.com/mmurakaru/cueloop/pull/411) [`7d5b2f5`](https://github.com/mmurakaru/cueloop/commit/7d5b2f53f0e3c77223f1c120b174d636a1fcbb61) Thanks [@mmurakaru](https://github.com/mmurakaru)! - The thread footer, with its repo/branch context and "send message" control, now rides the Changes pane while a zoom has hidden the Thread pane. Zooming the diff no longer strands the reviewer without a way to send a message.
- Updated dependencies []:
  - @cueloop/adapters@0.1.0-alpha.71
  - @cueloop/client@0.1.0-alpha.71
  - @cueloop/daemon@0.1.0-alpha.71
  - @cueloop/schema@0.1.0-alpha.71

## 0.1.0-alpha.70

### Minor Changes

- [#394](https://github.com/mmurakaru/cueloop/pull/394) [`9d324f0`](https://github.com/mmurakaru/cueloop/commit/9d324f07842abbcae957c3f12920edf771711180) Thanks [@mmurakaru](https://github.com/mmurakaru)! - Comment on any project file, not just a diff. Open a file from the Changes tree and select a line to leave a comment anchored to it, the same gesture as a plan or diff. The file reads with ordinary line numbers; your notes ride along with the file.

- [#393](https://github.com/mmurakaru/cueloop/pull/393) [`8a1b082`](https://github.com/mmurakaru/cueloop/commit/8a1b082500348159fe2adb9caba7977960380ec1) Thanks [@mmurakaru](https://github.com/mmurakaru)! - Comment on the working-tree diff from any review. The Changes panel is annotatable no matter how you opened the review, not just from `cueloop diff`: a note there attaches to the file and line it marks and re-anchors as the diff changes. Each surface shows only its own notes - the plan keeps its notes, the diff keeps the ones left on it.

- [#395](https://github.com/mmurakaru/cueloop/pull/395) [`86c0f23`](https://github.com/mmurakaru/cueloop/commit/86c0f23dc164e3e1d8ef3806e1b472e10687acfe) Thanks [@mmurakaru](https://github.com/mmurakaru)! - Feedback groups notes by where you left them. When you submit, the document your agent reads keeps the artifact's notes in one section and gives each file its own section, so a comment left on a file comes back beside that file rather than mixed into the plan.

- [#396](https://github.com/mmurakaru/cueloop/pull/396) [`fa2811e`](https://github.com/mmurakaru/cueloop/commit/fa2811e21cf68e8c355d645f93df741269800dd9) Thanks [@mmurakaru](https://github.com/mmurakaru)! - Threads are stored per project on disk. Each thread is an append-only log under a folder keyed by the repository's identity, so your review history is organized by project and survives moving or re-cloning the repo. Existing reviews migrate automatically on first launch.

- [#404](https://github.com/mmurakaru/cueloop/pull/404) [`3bc9c8c`](https://github.com/mmurakaru/cueloop/commit/3bc9c8cc2cf93050413eaddc38035b5b9a5ac538) Thanks [@mmurakaru](https://github.com/mmurakaru)! - A bare `cueloop` launch is now a real workbench: browse the current checkout and your project files freely, and the first comment you leave lazily creates a per-repo thread that persists across restarts and is shareable like any review. Nothing is written to disk until you comment, and the thread is keyed by the repository's identity, so every launch in that repo reattaches to the same workbench.

- [#408](https://github.com/mmurakaru/cueloop/pull/408) [`e49bf3d`](https://github.com/mmurakaru/cueloop/commit/e49bf3dedbcbebf599c9f05abf84945fa423a8bf) Thanks [@mmurakaru](https://github.com/mmurakaru)! - Added a built-in `/lgtm` quick action - a quick thumbs-up. Picking it inserts `/lgtm`, which expands for the agent to a terse "LGTM - This looks good to me." The quick-actions settings editor now scrolls and keeps the selected row in view, so a longer action list never overflows the dialog.

- [#385](https://github.com/mmurakaru/cueloop/pull/385) [`f91175e`](https://github.com/mmurakaru/cueloop/commit/f91175eda0712eaa3cfb96ce3a21a386a484e08e) Thanks [@mmurakaru](https://github.com/mmurakaru)! - Make the `prototype` review a component design doc by default. `cueloop prototype <file.md>` opens a Markdown proposal - the component's prop API, how it composes from existing primitives, and the callstack it sits in - reviewed as text, so annotations anchor to lines the same way a plan or diff does. The prototype skill prompts the agent to author those three sections.

  Rendering an HTML mockup as terminal pixels is now an opt-in experimental mode (`[experimental] prototype_pixels`); its renderer is code-split so none of the pixel/browser path loads into the runtime unless the flag is on. A closed right region now moves its reopen toggle into the header instead of leaving an empty gutter, and the landing page shots are refreshed to the current terminal UI.

  Scrollbars are now overlays across every view: the bar appears while a surface is scrolling and hides once it goes idle, instead of sitting permanently on any overflowing pane. Reviewer decisions are no longer called "verdicts" in the copy.

- [#407](https://github.com/mmurakaru/cueloop/pull/407) [`3af5f02`](https://github.com/mmurakaru/cueloop/commit/3af5f028305a3d96c975510e5d88f70869b8408f) Thanks [@mmurakaru](https://github.com/mmurakaru)! - The "/" palette now lists your user-level skills alongside cueloop's quick actions. Skills are discovered from `~/.agents/skills` by default (each `<name>/SKILL.md` with a name and description in its frontmatter); set `[skills] path` in your config to point elsewhere. Picking a skill inserts its `/name` and sends it to the agent as-is, since any harness already has it; a quick action of the same name takes precedence.

- [#405](https://github.com/mmurakaru/cueloop/pull/405) [`ac85fc2`](https://github.com/mmurakaru/cueloop/commit/ac85fc25c409704ecf39001fc4f14996be601fbf) Thanks [@mmurakaru](https://github.com/mmurakaru)! - Quick actions in the "/" palette insert a compact reference (a highlighted `/name`) instead of dumping the full prompt into your comment. The reference stays in the comment for you to read, and expands to its full text only when the review is sent to the agent. The palette now lays the name and description out in two columns (the description no longer wraps under the name), ranks matches by a fuzzy score, and tab-completes.

- [#397](https://github.com/mmurakaru/cueloop/pull/397) [`f22619c`](https://github.com/mmurakaru/cueloop/commit/f22619c1208d7ce84f571830b796ec1bea5c1e40) Thanks [@mmurakaru](https://github.com/mmurakaru)! - The welcome page is a live comment playground. Select its text and start typing to leave a comment, exactly as you would on a file or a diff, and type "/" while composing to see the quick actions and skills. Notes made here are a warm-up: they show inline but are never saved.

### Patch Changes

- [#410](https://github.com/mmurakaru/cueloop/pull/410) [`0749d76`](https://github.com/mmurakaru/cueloop/commit/0749d7659a0628af158ffabea95083aa2ff53b28) Thanks [@mmurakaru](https://github.com/mmurakaru)! - Rename the internal `ReviewSession` type to `Thread`, the product's word for the artifact you review: the schema interface, the daemon store and record validators, and the client controller module all follow. The JSON-RPC `session.*` methods and the `cueloop session` CLI verbs are unchanged, so installed agent adapters and scripts keep working. `session.comment` joins as the primary annotate method; `session.annotate` stays as an accepted alias.
- Updated dependencies []:
  - @cueloop/adapters@0.1.0-alpha.70
  - @cueloop/client@0.1.0-alpha.70
  - @cueloop/daemon@0.1.0-alpha.70
  - @cueloop/schema@0.1.0-alpha.70

## 0.1.0-alpha.69

### Patch Changes

- [#384](https://github.com/mmurakaru/cueloop/pull/384) [`6a60b64`](https://github.com/mmurakaru/cueloop/commit/6a60b643f86e3a5d38639cc0ad68d9c1503d3146) Thanks [@mmurakaru](https://github.com/mmurakaru)! - Adopt the Effect TypeScript library, starting at the daemon wait/wake seam. `effect` is added as a dependency and the interruptible long-poll behind `awaitResolve` and `awaitVerdict` now runs on Effect (`Effect.callback`, `Effect.raceFirst`, `Effect.repeat`) through a new `interruptible-wait` module, keeping the Promise API and socket protocol unchanged. AGENTS.md documents the read-first Effect workflow.

- [#369](https://github.com/mmurakaru/cueloop/pull/369) [`2b52c9c`](https://github.com/mmurakaru/cueloop/commit/2b52c9cf110127d2e3c203193296cb37dacc7205) Thanks [@mmurakaru](https://github.com/mmurakaru)! - The app fires a ready signal once, after the first frame that paints a usable screen with its keyboard handlers subscribed: an `onReady` callback for in-process tests and, when `CUELOOP_READY_FILE` names a file, that file for subprocess tests. Every App suite and the PTY tier boot on it instead of probing keys or reading output silence. CI runs the test suite once instead of retrying it three times; the retry had not fired in the last 18 green runs. No user-visible behavior changes.

- [`532391b`](https://github.com/mmurakaru/cueloop/commit/532391b5945473297161d7d3693e610c9d4b566c) Thanks [@mmurakaru](https://github.com/mmurakaru)! - Tooling and docs only: pull requests get a sticky benchmark comment comparing the head against its merge base on the source-only benchmarks (informational, never blocking), every push to main records a benchmark history on the bench-history branch and runs a daemon memory leak check, and the docs site gains a Performance reference page that renders that history as trend lines. No shipped behavior changes.

- [#373](https://github.com/mmurakaru/cueloop/pull/373) [`7b5da07`](https://github.com/mmurakaru/cueloop/commit/7b5da070f390b0d20c1eeb34bba055cfc03bcdcf) Thanks [@mmurakaru](https://github.com/mmurakaru)! - Release tooling only: a benchmark gate in the release workflow measures the previous published binary and the fresh one on the same runner, interleaved, and refuses to stage a release whose startup or first frame got materially slower (both a relative and an absolute threshold must be exceeded). Reviewed regressions can be accepted until a named version, renamed metrics stay comparable through an alias map, and a manual run can publish over a regression with a written reason. The comparison is attached to the GitHub release. No shipped behavior changes.

- [#372](https://github.com/mmurakaru/cueloop/pull/372) [`591e933`](https://github.com/mmurakaru/cueloop/commit/591e9333875997f25dad696666ef8c60c9beebae) Thanks [@mmurakaru](https://github.com/mmurakaru)! - Tooling only: a benchmark suite under `benchmarks/` measures binary startup, plan and diff parsing, daemon round trips, the TUI's first frame in a real pseudo terminal, key press latency, and memory, with a sampler that runs each script as a cold process and reports median and p95 as JSON. `bun run bench`. No shipped behavior changes.

- [#383](https://github.com/mmurakaru/cueloop/pull/383) [`eda1d43`](https://github.com/mmurakaru/cueloop/commit/eda1d434c7d820d917b17908538896a3b06f020e) Thanks [@mmurakaru](https://github.com/mmurakaru)! - The Changes navigator opens every changed file as a real diff, for any thread - not just a diff review. A non-diff thread (a plan, or the no-session welcome) computes the live working-tree diff against HEAD on demand; a diff review keeps showing its captured snapshot. The read-only file-contents view in the Project panel now syntax-highlights with the language detected from the file path.

  Upgrades no longer strand a stale daemon: the client and daemon exchange build versions on connect, and a newer client automatically replaces a daemon left running from an earlier build instead of talking to old code. In development, `bun run dev:watch` reloads the daemon on source edits.

- [#375](https://github.com/mmurakaru/cueloop/pull/375) [`70b683f`](https://github.com/mmurakaru/cueloop/commit/70b683f074b493ef6c1ff8ee7d003c60643830a9) Thanks [@mmurakaru](https://github.com/mmurakaru)! - An install matrix that verifies every published install path. Six scenario scripts, written in pure POSIX so they run on a bare distribution, drive the curl installer on a clean machine, on a rerun, and across an upgrade, plus the global npm package, the Homebrew formula, and the plugin manifest. A weekly workflow runs them on hosted macOS and Linux, on Windows, and inside Debian, Fedora, Arch, and Alpine containers against the real published release, and files a tracking issue when a scheduled run fails. The release workflow serves the freshly staged binaries from a local release tree and runs the curl scenarios against them before publish, so a broken installer blocks the release. No user-visible behavior changes.

- [#370](https://github.com/mmurakaru/cueloop/pull/370) [`eb20601`](https://github.com/mmurakaru/cueloop/commit/eb206012a1d45b4fddb386a306488f11813abaa5) Thanks [@mmurakaru](https://github.com/mmurakaru)! - The curl installer is idempotent (an exact version match downloads nothing), accepts `CUELOOP_VERSION` as a bare version or a tag, adds its install directory to your shell rc once (or to GITHUB_PATH in Actions), takes `--no-modify-path` and `--help`, and reads `CUELOOP_RELEASES_API` and `CUELOOP_DOWNLOAD_BASE` so mirrors and tests can point it at another server. It runs nothing until its last line, so a truncated `curl | sh` dies on a parse error instead of running a prefix. The install docs list every option, and the nix tab is gone until a flake exists. Tests cover every failure path offline against a local release server, on Linux and macOS.

- [#382](https://github.com/mmurakaru/cueloop/pull/382) [`0d1b0a9`](https://github.com/mmurakaru/cueloop/commit/0d1b0a9fa3a9fc0e05c206d9299196d5846d8a42) Thanks [@mmurakaru](https://github.com/mmurakaru)! - Disable the install-vm nightly schedule until its guest rootfs is tool-complete. The pinned Firecracker CI rootfs is a minimal boot image without curl, wget, or the scenario shells, so a full nightly run is not green yet; the workflow still runs on demand and on harness changes. No user-visible behavior changes.

- [#379](https://github.com/mmurakaru/cueloop/pull/379) [`0ee4ba7`](https://github.com/mmurakaru/cueloop/commit/0ee4ba79345c3aa8ea21c07d330c9f735531fc73) Thanks [@mmurakaru](https://github.com/mmurakaru)! - Pin the install-vm base artifacts to the real Firecracker CI URLs and their sha256, so the clean-machine install tests can run. The rootfs is Ubuntu 22.04 (the version the CI bucket publishes for Firecracker v1.10), and `--update-pins` now records both architectures from one machine. No user-visible behavior changes.

- [#381](https://github.com/mmurakaru/cueloop/pull/381) [`38547c5`](https://github.com/mmurakaru/cueloop/commit/38547c52dfdcce3ec3fa012e3d3524670233bece) Thanks [@mmurakaru](https://github.com/mmurakaru)! - Run the install-vm controller container privileged. Building the guest rootfs (unsquashfs, chroot, mkfs) and booting Firecracker (the kvm and tun devices, tap networking) need capabilities a dropped set cannot cover, so the earlier restricted set failed to even extract the Firecracker binary. No user-visible behavior changes.

- [#380](https://github.com/mmurakaru/cueloop/pull/380) [`f50ecd4`](https://github.com/mmurakaru/cueloop/commit/f50ecd42ab33358a3d8107062181dccd4e05e64e) Thanks [@mmurakaru](https://github.com/mmurakaru)! - Run the clean-machine install tests on x64 only and pass a scenario filter only when the dispatch names one. GitHub's free hosted arm64 Linux runners do not expose /dev/kvm, so a guest cannot boot there; an empty scenario input no longer breaks argument parsing. No user-visible behavior changes.

- [#376](https://github.com/mmurakaru/cueloop/pull/376) [`d8908b4`](https://github.com/mmurakaru/cueloop/commit/d8908b47e7baea1caa3941d7643d553830a4dc4b) Thanks [@mmurakaru](https://github.com/mmurakaru)! - Clean-machine install tests that run the real installer inside a fresh Firecracker microVM, one per scenario, on hosted Linux runners with KVM. A microVM is a truly clean box, so this catches installer bugs that shared runners and containers cannot: a missing shared library, an empty PATH, an unset HOME, a daemon left running, or no network. Seven scenarios cover a clean install, an upgrade, failed-install preservation, offline operation, shell rc edits under bash, zsh, and fish, a machine with no downloader, and an unset HOME. The scenarios reuse the install-matrix contract, so a skipped assertion still fails. A nightly workflow runs them on x64 and arm64 and files a tracking issue on a red run; it never runs on pull requests, since it needs sudo and boots a VM. No user-visible behavior changes.

- [#367](https://github.com/mmurakaru/cueloop/pull/367) [`dcca5e1`](https://github.com/mmurakaru/cueloop/commit/dcca5e1038e510a286574ffd8a7e7bf2c4af0d26) Thanks [@mmurakaru](https://github.com/mmurakaru)! - Test and CI only: a PTY keybinding suite presses every chord the thread view cheatsheet advertises against the real TUI and fails on any chord without a screen expectation or a documented reason it is unwired. The PTY tier now runs in CI on the Apple silicon runner and against the compiled darwin-arm64 binary in the release build. ctrl chords with enter, tab, backspace, and escape are encoded in the xterm modifyOtherKeys form the app's input parser accepts. No shipped behavior changes.

- [#369](https://github.com/mmurakaru/cueloop/pull/369) [`2b52c9c`](https://github.com/mmurakaru/cueloop/commit/2b52c9cf110127d2e3c203193296cb37dacc7205) Thanks [@mmurakaru](https://github.com/mmurakaru)! - `cueloop update` now resolves its install target from the real on-disk executable (`process.execPath`) instead of `argv[1]`, which in a Bun single-file executable is the virtual `/$bunfs/root/cueloop` path. That path made the installer try to write into a read-only filesystem (`mkdir: /$bunfs: Read-only file system`), breaking every self-update. The command also learns the installed version: it reports the current version, checks the newest published release, and short-circuits with `cueloop is up to date (<version>)` when nothing newer exists (never downgrading), printing a restart notice after a successful update. A new `cueloop update --dry-run` reports the resolved target without any network work.
- Updated dependencies []:
  - @cueloop/adapters@0.1.0-alpha.69
  - @cueloop/client@0.1.0-alpha.69
  - @cueloop/daemon@0.1.0-alpha.69
  - @cueloop/schema@0.1.0-alpha.69

## 0.1.0-alpha.68

### Patch Changes

- [#363](https://github.com/mmurakaru/cueloop/pull/363) [`2c3828d`](https://github.com/mmurakaru/cueloop/commit/2c3828d3e29c08383eab3018921185ecae10d53a) Thanks [@mmurakaru](https://github.com/mmurakaru)! - Add `cueloop update`, which reruns the published installer into the stable user bin directory.

- [#361](https://github.com/mmurakaru/cueloop/pull/361) [`9c7659d`](https://github.com/mmurakaru/cueloop/commit/9c7659dd76f30c108d56f9d595604b09664c48b1) Thanks [@mmurakaru](https://github.com/mmurakaru)! - Test-only: the PTY tier now drives the real TUI through a shared harness that feeds pseudo-terminal output into the in-repo Ghostty VT emulator, so tests press named keys and assert on the rendered screen grid instead of stripped raw bytes. Wait helpers carry the last screen in every timeout error and never re-send a dropped key. No shipped behavior changes.
- Updated dependencies []:
  - @cueloop/adapters@0.1.0-alpha.68
  - @cueloop/client@0.1.0-alpha.68
  - @cueloop/daemon@0.1.0-alpha.68
  - @cueloop/schema@0.1.0-alpha.68

## 0.1.0-alpha.67

### Minor Changes

- [#344](https://github.com/mmurakaru/cueloop/pull/344) [`02a91e6`](https://github.com/mmurakaru/cueloop/commit/02a91e61ac77dcce39ed55c543be8c4f69530b2c) Thanks [@mmurakaru](https://github.com/mmurakaru)! - Reshape the review surface into one app shell with four slotted panes - Threads, Thread, Changes, Project - under a single header row.
  The Changes pane is a tabbed editor grid: a dismissable Changes tab holds the whole diff in one scroll, files open as their own tabs, and tabs split into editor groups left, right, up, or down; a zoom control hides the thread and widens Changes.
  The Project pane is the right sidebar - always open when the right region is on, with the Changes editor riding on it - and switches between the changed files and the full project tree; clicking a file opens its diff or its contents in the Changes pane.

- [#343](https://github.com/mmurakaru/cueloop/pull/343) [`cda40b3`](https://github.com/mmurakaru/cueloop/commit/cda40b31f22f21eb6105d9e2a9a7fe217c37967c) Thanks [@mmurakaru](https://github.com/mmurakaru)! - Sharpen the sidebar and header. Long thread titles fade to a clean right-edge mask instead of wrapping; hovering or selecting a thread reveals a kebab that opens an inline pin / rename / delete menu, pinning lifts the thread into a Pinned section at the top, and a thread can be renamed through a new daemon title command. The header is one segmented bar that mirrors the open thread's name with the owner's Edit and Share beside it, and the diff pane reads as a flat editor surface without its own frame.

- [#343](https://github.com/mmurakaru/cueloop/pull/343) [`cda40b3`](https://github.com/mmurakaru/cueloop/commit/cda40b31f22f21eb6105d9e2a9a7fe217c37967c) Thanks [@mmurakaru](https://github.com/mmurakaru)! - Retire the separate inbox screen. Opening the app with nothing selected lands directly in the shell - the same header and Projects/Threads sidebar as a thread view, with a disposable Welcome tab in the center that points at where to start, the docs, and what shipped in this build. Closing the Welcome tab leaves a bare select-a-thread hint, and picking a thread swaps the center for it.

### Patch Changes

- [#341](https://github.com/mmurakaru/cueloop/pull/341) [`dd36611`](https://github.com/mmurakaru/cueloop/commit/dd366115c74f058b9f7d1193580fa7b47a8bb7e4) Thanks [@mmurakaru](https://github.com/mmurakaru)! - Align installer progress symbols with the banner and keep message text fixed as loaders change to checkmarks.
  Remove the cueloop prefix from install progress and completion messages.
- Updated dependencies [[`cda40b3`](https://github.com/mmurakaru/cueloop/commit/cda40b31f22f21eb6105d9e2a9a7fe217c37967c), [`cda40b3`](https://github.com/mmurakaru/cueloop/commit/cda40b31f22f21eb6105d9e2a9a7fe217c37967c)]:
  - @cueloop/client@0.1.0-alpha.67
  - @cueloop/daemon@0.1.0-alpha.67
  - @cueloop/schema@0.1.0-alpha.67
  - @cueloop/adapters@0.1.0-alpha.67

## 0.1.0-alpha.66

### Minor Changes

- [#339](https://github.com/mmurakaru/cueloop/pull/339) [`53384b9`](https://github.com/mmurakaru/cueloop/commit/53384b973d5428187666ac2aa7a3ea3cc204fea2) Thanks [@mmurakaru](https://github.com/mmurakaru)! - Add a context-driven Changes column, a tree-nav settings dialog, and inline skill completion in the composer. A diff thread opens with a right-hand column that lists its changed files as a directory tree; clicking a file scrolls the diff to it, and the right panel icon toggles the column. The settings gear opens a dialog whose left navigation is a keyboard-navigable tree, with the keyboard reference as a leaf and the version in the footer. Typing a skill reference mid-comment shows a tab-hint with the closest match; tab completes it to the full name, and references chain inline.

- [#336](https://github.com/mmurakaru/cueloop/pull/336) [`8889294`](https://github.com/mmurakaru/cueloop/commit/88892948ecbc37caf94e9ef01a5d53750afc2364) Thanks [@mmurakaru](https://github.com/mmurakaru)! - Reshape the review surface into an edgy app shell. The sidebar groups reviews into Projects and Threads keyed by a location-proof repo identity that survives moving or re-cloning the repo, and jumps between threads beside the thread view. The thread footer carries the repo and branch with a send-message control, brand-purple accents and nerd-font icons run throughout, and `cueloop dev` opens the TUI on an isolated home seeded with example threads.

### Patch Changes

- Updated dependencies [[`53384b9`](https://github.com/mmurakaru/cueloop/commit/53384b973d5428187666ac2aa7a3ea3cc204fea2), [`8889294`](https://github.com/mmurakaru/cueloop/commit/88892948ecbc37caf94e9ef01a5d53750afc2364)]:
  - @cueloop/client@0.1.0-alpha.66
  - @cueloop/daemon@0.1.0-alpha.66
  - @cueloop/schema@0.1.0-alpha.66
  - @cueloop/adapters@0.1.0-alpha.66

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
- Updated dependencies [[`d4bfddc`](https://github.com/mmurakaru/cueloop/commit/d4bfddc0057c131c82c46258bc1921e11302e7ad), [`1b8253c`](https://github.com/mmurakaru/cueloop/commit/1b8253c0f2159e99244e1fdae9a3350eabb68055), [`6c5fdab`](https://github.com/mmurakaru/cueloop/commit/6c5fdab8ba7098344a051e5a0ef779af783c1249), [`3199a76`](https://github.com/mmurakaru/cueloop/commit/3199a76ec6af4fd6cc8c38a451522224c11229ea), [`3adc09e`](https://github.com/mmurakaru/cueloop/commit/3adc09e5294ef384872c1a8e578231c65ce76ce4), [`a9de22e`](https://github.com/mmurakaru/cueloop/commit/a9de22e9680fa4ba7e79e3b86815ec49ea6a01e6), [`dcbd48d`](https://github.com/mmurakaru/cueloop/commit/dcbd48d2325e74230b7911038b0c51a0a2e3449b), [`8e56045`](https://github.com/mmurakaru/cueloop/commit/8e56045b6081a851a757cf33b676382c04c07446), [`3ee474c`](https://github.com/mmurakaru/cueloop/commit/3ee474cb4772b8a227686e32a960c1587e0f5c27)]:
  - @cueloop/daemon@0.1.0-alpha.65
  - @cueloop/schema@0.1.0-alpha.65
  - @cueloop/client@0.1.0-alpha.65
  - @cueloop/adapters@0.1.0-alpha.65

## 0.1.0-alpha.64

### Patch Changes

- [#304](https://github.com/mmurakaru/cueloop/pull/304) [`49feedc`](https://github.com/mmurakaru/cueloop/commit/49feedc74de12b677a13455b18c223743d125691) Thanks [@mmurakaru](https://github.com/mmurakaru)! - Parse untrusted JSON (persisted state, registry documents, external configs) with schemas at every I/O boundary, and enforce the new type-evidence lint rules across the workspace.
- Updated dependencies [[`49feedc`](https://github.com/mmurakaru/cueloop/commit/49feedc74de12b677a13455b18c223743d125691)]:
  - @cueloop/adapters@0.1.0-alpha.64
  - @cueloop/client@0.1.0-alpha.64
  - @cueloop/daemon@0.1.0-alpha.64
  - @cueloop/schema@0.1.0-alpha.64

## 0.1.0-alpha.63

### Minor Changes

- [#303](https://github.com/mmurakaru/cueloop/pull/303) [`17d2789`](https://github.com/mmurakaru/cueloop/commit/17d278988d2c65f7e1e5e635fc103c5de79f961a) Thanks [@mmurakaru](https://github.com/mmurakaru)! - Any cueloop primitive can now return its verdict into a live pi session. The schema's artifact types become one runtime union (ARTIFACT_TYPES); daemon wire validation, `cueloop session create --type`, and the pi extension's request_review tool all derive their supported set from it. request_review takes `content` plus an optional `type` (default plan) and `title`, keeping the same waiter map, write gate, and shutdown abort for every primitive. A resubmit under the same agent session id only revises a session of the same artifact type, and a reply review's feedback document references reply.md.

### Patch Changes

- Updated dependencies [[`3fbe5e8`](https://github.com/mmurakaru/cueloop/commit/3fbe5e8e9d466a72e17bce743ab72f049513dc3e), [`17d2789`](https://github.com/mmurakaru/cueloop/commit/17d278988d2c65f7e1e5e635fc103c5de79f961a)]:
  - @cueloop/client@0.1.0-alpha.63
  - @cueloop/schema@0.1.0-alpha.63
  - @cueloop/daemon@0.1.0-alpha.63
  - @cueloop/adapters@0.1.0-alpha.63

## 0.1.0-alpha.62

### Minor Changes

- Annotations now resolve when a revision addresses them, so re-review shows only what is still open. The feedback document lists each annotation's id and teaches the agent to report what it acted on (`cueloop session submit-revision <id> --addressed <id,id>`); reported annotations are marked addressed by that revision. As an assist, a plan revision that removed an annotation's quoted text marks it addressed too ("drift"). Addressed annotations leave the rail (a dim `✓ N addressed by revision` line keeps the count), lose their document highlight, stop counting toward the pending badge and the verdict default, and stay out of the next feedback document - but they are never deleted from the session record.

- Turn the review rail's Agent tab into a bring-your-own-harness launcher. It now shows branded claude code / pi / codex cards; clicking one runs that harness in a herdr split beside the review, so a reviewer can ask an agent about the plan without leaving the tab. A plan-context toggle seeds a briefing (read the plan, comment via `session annotate`, do not rewrite) into the launched split. The old dead agent/status/revision placeholder becomes a compact footer line.

- Widen the annotation surface so review-side agents write the same authored, span-anchored comment a human does. `session annotate` now takes `--author` (and `--author-name`, which registers the collaborator's display name in the participant registry) and `--action <index|name>`, which expands a shared quick-action preset into the comment body. A new `cueloop actions list` prints that vocabulary so an agent can reference a preset by name. The built-in quick actions now ship with a system-prompt sentence each. A new `cueloop:annotate` skill wraps read-plus-comment for any bring-your-own harness, documenting the quote-exact anchor contract and the annotate-only rights boundary.

- Near-live sync for shared plans. While you have a plan you shared open, cueloop now re-pulls collaborator notes every few seconds, so a teammate's comments stream in without reopening anything. It is bidirectional: your own notes and edits on a shared plan mirror up to the share, so collaborators see them on their next refresh. Everything still converges by id, so order never matters and there is nothing to resolve by hand.

- Name and manage collaborators. A share viewer is asked for a display name the first time they open a shared plan, so their notes attribute to a name rather than an SSH fingerprint; skipping keeps them anonymous, and a name from a past visit is remembered. The planner can rename any collaborator from the rail - r on a selected note, or activate the note (click it again, or e) - stored per fingerprint in the user config. The inbox gains a delete action (d, or the [delete] button) behind a centered confirm dialog, so finished plans can be cleared.

- The annotation composer now follows the Slack newline convention. Plain Enter still saves the note, while Option/Alt+Enter (and Shift+Enter, as before) insert a newline so you can write a multi-line comment without leaving the box; Cmd/Ctrl+Enter is a submit alias. The input also auto-grows as you type: a long line that soft-wraps expands the box the same way a hard newline does, up to four rows, after which it scrolls internally and keeps the caret line in view.

- Rejected diff hunks and cut plan blocks now appear in the review rail as their own cards, interleaved with annotation cards in reading order rather than grouped at the bottom. Each removal card previews the removed content struck through and dimmed; selecting one reveals its source line and shows an undo button (the same restore path as the `u` key), so a rejection reads like any other queued item you can take back before you submit. Inline, a cut span is now simply struck through and grayed rather than boxed with a `[cut]` tag, and saved annotation cards carry a uniform bordered frame titled `ACTION · author`. The composer's Cancel button drops its redundant ` esc` hint (esc still cancels).

  Keyboard scrolling in the diff sheet is now smooth: the layout model counted a wrapped annotation body or file header as one row while it rendered as several, so the cursor-follow scroll drifted and shifted the view. Those content lines no longer wrap, so the scroll target matches the real layout and the cursor holds a stable screen row.

- Enforce owner / collaborator / agent roles at the daemon socket. A connection is the owner by default (local single-user is unchanged); a review-side agent connects with `--role agent` (a `daemon.hello` handshake), and the daemon then caps it to reading the session and adding annotations - any attempt to resolve, submit a revision, edit, cut, share, or delete is refused. The capability map is one source of truth (`capabilities.ts`). The `cueloop:annotate` skill now passes `--role agent`, so a bring-your-own agent literally cannot escalate.

- Annotations collapse to a single `comment` kind. The `s` suggest keybinding is gone (the key is now unbound), and the suggestion "Replace/With" feedback rendering is removed - every annotation serializes as a comment. Working-copy edits and hunk curation already give a stronger, directly-applied way to propose a concrete change, so the suggestion kind was redundant.

  BREAKING (alpha) for `@cueloop/schema`: `AnnotationKind` no longer lists `"suggestion"`. The kind set stays open (`"comment" | (string & {})`) for forward-compat with agent notes and other kinds.

- Run the review agent inside the Agent tab, not a separate pane. Picking claude code / pi / codex now embeds a real terminal in the rail: the harness runs on a PTY through Ghostty's own VT core (libghostty-vt via a small FFI shim) and paints into the OpenTUI canvas cell-by-cell, with colors, text attributes, and a live cursor. While it is focused the keyboard routes to the agent; ctrl+] detaches back to the review. Where no prebuilt libghostty-vt ships for the platform, it falls back to the previous herdr-split launch, so nothing breaks. Ships a darwin-arm64 prebuilt today; other platforms use the split until their prebuilts land.

- Add an opt-in Prometheus `/metrics` endpoint to the sharing gateway (ADR 0007, Layer 2). Off by default and bound to loopback - it starts only when `CUELOOP_METRICS_PORT` is set, so it never faces the public port and production is unchanged until an operator opts in. It exposes share-verb success/error counts + latency (`cueloop_share_ops_total`, `cueloop_share_op_duration_seconds`) and R2 operation outcomes (`cueloop_r2_ops_total`), the SLIs a scraping agent (e.g. Grafana Cloud) needs. Box CPU/mem/disk stay the agent's node integration.

- Guided walk for diff reviews: press w in a diff session to step through every
  changed file as a focused card wizard with a plain step count. ] advances and
  marks the file viewed (persisted with the session, so a resumed review keeps
  its progress), [ steps back, esc leaves keeping progress, and the end card
  offers Submit review directly. Submitting agents can attach per-file notes
  (annotations with kind "note" anchored by the file path) that render in the
  wizard's agent-note block and as rail cards; notes are agent context and never
  come back as reviewer feedback. The submit confirm shows the honest viewed
  count for walked diff sessions.

- A review created from inside herdr now opens itself. When the Claude Code hook or `cueloop session create` starts a genuinely new review from a herdr pane, cueloop opens a fresh herdr tab, focuses it, and launches the review in it - no more copying a command out of the log by hand. A resubmit reuses the pane the original review already opened, so revisions never spam new tabs. It stays best-effort like the rest of the herdr tier: a missing or broken herdr binary is swallowed and never blocks the review, and outside herdr nothing changes.

- Add the marker-actions popover to plan review: marking a span (`v`) now shows an inline toolbar at the block - `comment · cut · actions · [x]` - each label keyboard-shortcut-backed and clickable, so span mode is discoverable rather than blind. `a` opens a quick-actions list of preset comments you pick with `j`/`k` and `⏎` (or a click), inserting the prompt as a comment on the span in one step; `x` cuts the whole block the span sits in. The list is configurable through a new `[[actions]]` config section (`prompt` plus optional `metadata`); defining any replaces the built-in review prompts. A mouse drag-select on a plan also opens the popover at the dragged range - one marker at a time.

- The automatic plan-mode gate (the `ExitPlanMode` hook) is now non-blocking. Instead of freezing the turn until the reviewer decides, it opens the review, arms a detached inbox waiter, and denies the exit immediately - so the agent ends its turn and you keep chatting while the plan is open. When you submit a verdict cueloop injects it into the live session; on approval the agent presents the same plan again and is allowed through. This closes the last place plan review still blocked the agent.

- Non-blocking review with a per-harness wake (ADR 0008). A plan can now be submitted without freezing the agent's turn: the human keeps chatting while the plan is open, and when they return a verdict cueloop resumes the driving agent with the feedback instead of relying on the harness to re-poll a blocked tool.

  - daemon: a new `awaitResolve(client, sessionId)` seam parks on one session's verdict from a session id alone (no ReviewHandle needed), so any background waiter can collect the outcome; the held connection and the pending session both keep the daemon off its idle-exit path for the whole wait.
  - pi: the `request_review` tool returns immediately with the session id and a background waiter injects the verdict with `sendUserMessage(deliverAs: "followUp")` when it lands; the pending-review write gate still holds mutating tools, and session shutdown aborts any waiter still parked.
  - Claude Code: a detached inbox waiter posts the verdict into the live session over `CLAUDE_CODE_MESSAGING_SOCKET` (the frame matched to Claude Code's own example), which Claude reads between tool calls or as a fresh turn when idle. The blocking ExitPlanMode gate is unchanged.
  - Codex: a detached waiter queues the verdict into the running thread via `codex queue` (app-server `thread/queue/add`), which auto-submits when the thread next goes idle. Weakest of the three paths - it needs Codex under the shared app-server daemon and still wants live-codex QA.

- Plan review surface v2: selection is the entry primitive (mouse drag or keyboard span on one native renderer selection), the compose box opens inline under the anchor instead of the bottom bar, annotation text lives in the rail while the document keeps only the kind-colored highlight, rail cards edit in place, and exiting the editor hand-off re-anchors every annotation - orphaned ones are flagged in the rail with a one-line reconciliation banner above the sheet.

- Pull collaborator notes on a shared plan back to the planner. When you share a plan, cueloop now records the share id on the session; `cueloop share pull [session-id]` (and opening a shared plan in the TUI) fetches the share's current notes and unions them into your local plan by id, so teammates' comments show up without losing your own. The gateway lets only the fingerprint that created the share pull it back.

- Add a Settings "Actions" category to edit the quick-action vocabulary. Each quick action is a row whose prompt, when clicked, expands a focused input for its system prompt (the guidance appended when the action is used); a reset-to-defaults control and an add-action row bracket the list. Edits persist to `[[actions]]` in the user config, so the presets a human picks and the ones an agent references via `annotate --action` stay one shared, editable set.

- Attribute collaborator annotations in the review rail. A note pulled from a shared plan now renders as a bordered card titled with the author's handle (derived from their SSH fingerprint until display names are captured), so a teammate's notes stand out from your own - which stay borderless. Own-only rails are unchanged.

- The submit confirm now lives in the review rail: pressing submit expands the rail's Submit button into a bordered confirm card - honest counts (`N annotations · M blocking`), the Comment / Approve / Changes verdict selector (arrow keys or click), the optional summary input, and plain Submit / Cancel word-buttons - replacing the detached full-width bottom bar. The annotation stack above stays scrollable while the card is open, key hints stay in the status line, read-only observers never see the card, and the keybinding surface is unchanged.

- Add the `refine` primitive: `cueloop refine` reads the corpus of past review sessions and writes a Markdown report to `~/.cueloop/reports/` (latest `report.md` plus a timestamped copy). The report gives corpus stats, reviewer annotations grouped by kind with their session/primitive/verdict/week, and weekly volume; a run analyzes up to 200 unseen sessions and skips sessions with no annotation and no verdict. The `/cueloop:refine` skill drives the agent to group the annotations into named patterns and propose writebacks (to a skill, `AGENTS.md`, `CLAUDE.md`, or memory) for human approval via a plan review. Adds a `cleanupPeriodDays` retention window (default 30) read from `[cleanup] period_days`: the daemon prunes sessions past the window on startup, and `refine` prunes old reports.

- Add the `reply` primitive: `cueloop reply` opens the latest pending reply review (or one by id/title), and the `/cueloop:reply` skill submits the agent's previous message for line-level human review. A reply is a first-class markdown artifact type, so it renders through the plan sheet, derives its title from the first heading, and gets revision drift-assist - the plan-like behaviors now key on the shared `isMarkdownArtifact` predicate in `@cueloop/schema` rather than a `type === "plan"` literal. Content flows through the existing skill path (the agent writes its reply to a file and submits `--type reply`), so there is no transcript reader and no new daemon plumbing. The verdict rides the same non-blocking wake as plan reviews.

- The review panel now resizes and collapses so the plan gets the width it needs. It cycles through three states with `b`: expanded (the full annotation rail), compact (a narrow strip that keeps the count and one accent dot per annotation), and hidden (gone entirely, so the plan takes the full terminal, reopened with the same key and no leftover tab). Drag the single-column divider between the plan and the rail to resize the expanded width, or nudge it with `[` and `]`; the divider accents while you drag and the width is clamped to a sensible range. A muted chevron on the panel's edge toggles expanded and compact with a click (`»` to collapse, `«` to expand). The collapse state and rail width persist to `[ui] review_state` and `[ui] review_width` in your config, so the layout you pick survives a restart.

- First alpha of the terminal review surface: the ReviewSession primitive end to end - plan review round-trip with Claude Code (annotate, span-select, Cut, $EDITOR edits, verdict + feedback.md), working-tree diff review, the inbox, a lazy unix-socket daemon with resumable waits, the typed extension API with trusted repo loading, layered TOML config with rebindable keys, and the Claude Code plugin packaging (/cueloop:plan, /cueloop:diff, /cueloop:review).

- SSH plan sharing: `cueloop share` (and a one-click Share button / ⇧S in the plan TUI) publishes a plan as one line - `ssh p_xxxxxxxx@cueloop.dev` - copied to the clipboard. A teammate pastes it and the plan renders in their terminal, no install, with every annotation already on it. They annotate too, and their notes union back into the shared blob attributed by SSH key, never overwriting the planner's. Backed by a new SSH gateway (raw ssh2, one port, shell renders / exec uploads) that seals each blob (AES-256-GCM, per-blob HKDF key) before it reaches R2. Annotations gain an optional `author` fingerprint; the review controller now renders the same TUI against a local session or a decrypted share.

- Pick a built-in color theme from Settings. A new Appearance tab cycles through the branded `cueloop` default (transparent, so your terminal background shows through) and five well-known palettes rendered from their first-party specs - Rosé Pine Moon, Catppuccin Mocha, Tokyo Night, Gruvbox Dark, and Nord - each painting its own opaque background. The choice applies live and persists to `[ui] theme` in your config; per-token `[theme]` overrides still layer on top of whichever preset you pick, so a hand-tuned accent survives a theme switch.

- The client UI is now a reusable component system. Every rendered surface lives in `components/` behind a strict tokens -> primitives -> domain layering, themed through a provider whose default is the built-in dark theme (config themes swap the provider; every component also takes a `theme` prop). Hand-rolled mechanisms were replaced with the documented terminal primitives: native word wrapping (quote anchors stay char-precise), a scrollable uncapped diff view with a real line-number gutter, multiline annotation composers (shift+enter for a new line), tree-sitter code highlighting, tab-strip rail tabs, a select-based verdict picker, suspend/resume around the `$EDITOR` hand-off, and responsive sizing from the terminal dimensions. Key bindings resolve through layered keymaps and the status-line hints are generated from the active bindings, so a rebound key shows its real binding. Each component ships stories; `bun run stories` browses them and the test suite snapshots every story.

- Opening a review is now verb-first: one verb per artifact type, each defaulting to the latest pending review of that type. `cueloop plan` opens the latest pending plan, `cueloop diff` opens the latest pending diff, and `cueloop review` opens the latest pending PR review. Each verb also addresses a specific session directly - `cueloop plan <session-id>` by id, or `cueloop plan <title>` by a case-insensitive title match (an exact title wins, a unique substring wins, and several matches list the candidates so you can name one). An explicit `--latest` (alias `--open`) always selects the default. The create paths stay: `cueloop diff` with a dirty working tree still creates a working-tree review, a clean tree opens the latest pending diff instead of erroring, and `cueloop review <pr>` still opens a pull request. Bare `cueloop` still opens the inbox and `cueloop <session-id>` still opens that session. A miss prints a plain "nothing to open" line instead of failing silently.

### Patch Changes

- Fix the Claude harness never launching from the Agent tab. Its command was `cc`, which is a personal shell alias for `claude` - but the embedded terminal spawns the binary directly on a PTY, where `cc` resolves to the system C compiler, so the pane ran the compiler instead of Claude Code (`pi` and `codex` are real binaries, so they worked). The command is now `claude`. Also strips the `▸` glyphs from the launcher buttons and plan-context toggle, and removes the inline `(⌃])` detach hint from the running-terminal header - the detach chord is now listed in the Keybinds cheatsheet (Settings) under "Agent terminal" instead. Detaching now tears the terminal down explicitly (the React reconciler detaches a child without destroying it), so the agent's child process no longer leaks after ctrl+].

- Tidy the Agent tab and rail width. The launcher is now three text-only buttons - "Claude Code", "Pi", "OpenAI Codex" - stacked tight without the ASCII logos, and all sharing one neutral color. Dropped the "Ask an agent about this plan" header and the bottom "<agent> · <status> · rev N" line (both redundant with the plan sheet header), so the buttons sit directly under the tabs. The rail also no longer indents its content: the tab body dropped a stray left padding (the Agent tab was indented two columns deeper than the Review tab) and the rail's own left padding, so annotation cards and the launcher buttons run full width from the divider seam.

- Stop annotations from orphaning when their quote carries a leading markdown marker, and re-bind lightly edited quotes. The parser strips block markers (`- `, `## `, `1. `, `> `) from block text, so a quote copied verbatim from the source - bullet and all - never matched the exact/trimmed lookup and dropped straight to an orphaned anchor. The anchor resolver now runs a longer cascade: exact -> trimmed -> marker-normalized -> fuzzy -> orphan. Marker stripping shares one `stripLeadingBlockMarker` utility with the parser so the two cannot drift, and the fuzzy tier (`levenshteinDistance` / `similarityRatio` / `fuzzyFindBestMatch`, standalone in `@cueloop/schema`) re-anchors a quote after a small edit, gated by a high similarity floor so it never binds to the wrong text. Fixing this in the resolver heals anchors already stored in a session and covers every author path (local, agent, gateway).

- Fix the Save and Cancel buttons in a saved annotation card's edit composer, which did nothing when clicked. The card is wrapped in a clickable box (`onMouseUp` selects/activates it), and a button press bubbled up to that box after firing, so activating the card immediately re-opened the editor and undid the action. Word-buttons now stop propagation on press, so a button inside any clickable surface consumes its own click instead of double-firing the ancestor.

- Annotation ids are unique by construction: a per-process counter joins the time component and the random suffix, so many ids minted on the same millisecond can never collide.

- Submitting a review now hands you back to the agent: a completion overlay confirms the verdict (and shows the vault-export path when one ran), offers to close, and can auto-close after a configurable delay - press `a` on the prompt once to opt in (persisted as `[ui] auto_close = 3`), set `0` for instant close, `"off"` to always be asked. `esc` stays in the resolved read-only view.

- Bump `diff` from 8.0.4 to 9.0.0. The client's intraline word-diff (`diffWordsWithSpace`) is unchanged and its tests plus the full suite pass; this also aligns the direct dependency with the `diff@9` that `@opentui/core` already resolves.

- Bump the `@opentui/*` group (core, react, keymap, ssh) from 0.5.1 to 0.5.2.

- Bump the `@opentui/*` group (core, react, keymap, ssh) to 0.5.8, aligned across the client and gateway. Keeping the whole group on one version collapses to a single `@opentui/core`, avoiding a dual-renderer install. Typecheck, the full test suite, and all render snapshots pass unchanged.

- [#287](https://github.com/mmurakaru/cueloop/pull/287) [`379e343`](https://github.com/mmurakaru/cueloop/commit/379e343c68e7057a3aee9dcfaea1d0c2a1ffae53) Thanks [@dependabot](https://github.com/apps/dependabot)! - Bump `@pierre/diffs` from 1.3.5 to 1.3.6. A patch release with no API change for the three call sites the client uses (`parsePatchFiles`, `parseDiffFromFile`, `diffAcceptRejectHunk`, `FileDiffMetadata`); typecheck, the diff projection and hunk-curation suites, and the full test run pass unchanged.

- `cueloop -v` / `cueloop --version` (and the bare `version` verb) now print the installed version and exit 0, instead of dumping the help text and exiting 2. `-h` is added as an alias for `--help`, and both are listed in the help output.

- The post-submit overlay is clearer: it counts down from 5 seconds by default (esc stays, a remembers the choice) instead of a static prompt, the action line reads as plain "label [key]" affordances with no glyphs (close [return] · closing in Ns · return to plan [esc] · always [a]), and the redundant verdict echo under the heading is gone.

- Test hardening: the inline-compose paint assertion waits on the span color instead of sampling the first frame after the keypress, which raced the anchor repaint on slow runners.

- [#290](https://github.com/mmurakaru/cueloop/pull/290) [`de64f99`](https://github.com/mmurakaru/cueloop/commit/de64f990647767f2482b90eadd283103979b63a2) Thanks [@mmurakaru](https://github.com/mmurakaru)! - Fix daemon autostart from the standalone binary. The client spawned `bun run main.ts` to launch the daemon, which only resolves from a source or npm install; a compiled binary (the curl and Homebrew install) has no `main.ts` on disk and its `execPath` is the cueloop binary rather than bun, so autostart failed with `daemon did not come up` whenever no daemon was already running - first launch, or after the daemon idle-exits. The client now detects the compiled binary via the Bun virtual-filesystem markers in `import.meta.url` and re-execs `cueloop daemon`.

- Guarantee one daemon per state directory. Concurrent autostarts previously raced: the second daemon unlinked the first one's socket and bound a fresh one, so two daemons served divergent in-memory sessions over the same files and a client could stop seeing sessions another had just created. Startup now takes an exclusive lock, a losing start exits quietly so the caller attaches to the live daemon, and stale locks from crashed daemons are reclaimed.

- A working-tree diff review now hot-reloads: while you have a `cueloop diff` session open, the daemon watches its repository and re-captures the diff whenever the working tree changes, so the review updates in place with no manual reload and no remount. Your annotations re-anchor across the refreshed patch through the usual anchor cascade. The daemon runs one recursive watcher per repository shared by its live diff sessions, debounces bursts of file writes into a single re-capture, ignores churn under `.git/` and `node_modules/`, and only broadcasts when the patch actually moved. A new owner-only `session.refreshDiff` verb is the seam the watcher drives and is scriptable on its own. Watching starts when a diff session is created (or recovered after a daemon restart) and stops when it resolves, is deleted, or the daemon shuts down.

- Diff hunk curation: while reviewing a working-tree diff, the owner can accept or reject individual hunks and changes in the terminal. `x` rejects (or restores) the change under the cursor, `⇧X` the whole hunk; rejected lines render struck through and dimmed. The curated result - the accepted changes only - becomes the review's working copy and flows to the agent as feedback, serialized as an exactly applyable unified diff.

  To make that exact, `cueloop diff` now captures the full old/new contents of every changed file (new optional `Artifact.files`), and curation re-parses each file with `@pierre/diffs` so a reject reverts precisely the chosen hunk or change. PR reviews carry a partial patch with no file contents, so curation stays disabled there with a clear status message.

- The diff review sheet now syntax-highlights code with tree-sitter: keywords, types, strings, and the rest wear their theme colors across context, added, and deleted lines, resolved off the render path so rows draw unstyled first. It composes with the intra-line word diff - a changed word keeps the diff color on top of its syntax color - and leaves the row-level annotation cards untouched. A hunk is highlighted as a contiguous fragment (so multi-line constructs tokenize correctly) and the filetype comes from the file path.

- Rename internals so every identifier states what it does: diff op fields (kind/oldValue/newValue), diff row kinds, key intents, and abbreviated locals across all packages; remove dead code and stale comments. No behavior change.

- Point the alpha dist-tag at the published release. Prereleases were landing on `latest` while `alpha` kept pointing at the first (broken) publish, so `npm i cueloop@alpha` served the wrong build; the release lane now retags every package and the verification step checks the tag a stranger would install, not just the exact version.

- Make the end-to-end suite deadline-based instead of iteration-based, so a cold CI runner paying for a subprocess and daemon start is not mistaken for a failure.

- Edit mode now works for every reviewer, in any shell. The editor resolves through `[ui] editor` config, then `$CUELOOP_EDITOR`/`$VISUAL`/`$EDITOR`, then a `nano` fallback, so a clean environment can still edit a plan (it used to throw). Known GUI editors get their wait flag applied automatically (`code --wait`, `subl --new-window --wait`, `zed --wait`, ...), and any editor that returns instantly with the file untouched drops to a confirm gate on the released terminal ("save and close it, then press Enter") instead of silently discarding the edit. Terminal editors are trusted to hold the terminal and never see the gate.

- Enforce a cyclomatic complexity limit of 20 (oxlint) and refactor the functions that exceeded it - the intent dispatcher, keymap reducer, config layering, App, plan-sheet run-style, the CLI command routers, and the daemon dispatch - into small, table-driven units. Behavior and public APIs are unchanged.

- Gateway connection-error logging is now classified: expected transport failures (bad handshake, auth abort, connection reset) from internet scanners on port 22 log one terse line instead of a full stack trace, while genuinely unexpected errors stay loud. Cuts log noise without hiding real faults.

- Fix the gateway leaving a collaborator's terminal in mouse-reporting mode. Quitting a shared plan now restores the terminal (disables mouse reporting, shows the cursor, leaves the alt screen) before the channel closes, so the local terminal no longer spews raw SGR mouse reports on every mouse move until `reset`. Previously the restore only ran after the channel had already closed, which dropped the bytes.

- `cueloop --help` now prints a grouped catalogue instead of a flat wall: the everyday verbs (`plan`, `diff`, `review`) sit under "common commands", with "share", "open a specific review", and "scripting" following. The command coverage is unchanged - the same entries, just organized so the common path is what you see first.

- Fix herdr tab auto-open: a review created inside a herdr pane now opens a new tab rendering it, as intended. `detectHerdr` required `HERDR_BIN_PATH`, which herdr 0.8+ does not set - it exposes `HERDR_SOCKET_PATH` and the `herdr` CLI on PATH - so detection silently failed and the auto-open (and agent-state reporting) no-op'd. `detectHerdr` now needs only `HERDR_ENV=1` + `HERDR_PANE_ID` and defaults the binary to `herdr` on PATH; an explicit `HERDR_BIN_PATH` still wins.

- First-class herdr hand-back: a review opened beside an agent now returns focus to the agent's pane when it closes. The adapter records the agent's pane on the session, and inside herdr the post-submit overlay defaults to a short countdown ("returning to claude-code") instead of a prompt; CUELOOP_RETURN_PANE overrides the target, and an explicit auto_close config still wins.

- Fixed herdr auto-open silently doing nothing. The `tab create` response parser expected `result.pane.id`, but real herdr (0.8.0) returns `result.root_pane.pane_id` - so a review created inside herdr never actually opened its tab. Verified against the real binary; the test stub now mirrors the real output shape.

- Re-planning in the same session now reliably shows the review in a herdr tab. Before, the auto-tab opened only for a brand-new review, so a resubmit whose original tab had been closed left an orphaned pending review with nothing on screen. cueloop now records the exact tab it opened (tab id + root pane id) in a herdr-namespaced daemon side-store - the core session model stays herdr-free - and on a resubmit checks that pane's liveness by id: a still-open tab is focused, a closed one is reopened, so there is never a duplicate and never a missing tab. Collision-free because it tracks the real ids, not a label.

- Fix the plan-gate review opening no herdr tab when the daemon is stale. Recalling the recorded tab handle from the daemon is now isolated from the tab-open flow, so a daemon that predates the herdr-tab verbs (or any recall failure) degrades to opening a fresh tab instead of silently opening nothing. The store write is likewise best-effort: a failure loses only the liveness-dedup handle, never the already-open tab.

- herdr tier-1 integration: panes report blocked/working state and review labels through the env contract; silent outside herdr.

- A plan shared over SSH now hides every plan-edit affordance from the viewer: the sheet-header Edit button is owner-only, the edit/cut keys are silent instead of nagging "shared plan - edit it in your own copy", and the hint strip drops cut/edit/submit. A collaborator still annotates, navigates, and edits their own notes.

- An adapter failure can no longer wedge the agent: whatever goes wrong inside cueloop, the hook emits a valid response carrying the reason instead of dying silently. Daemon autostart also waits longer (and reports why it gave up) so a cold or loaded machine is not mistaken for a broken daemon.

- The verdict selector in the submit confirm card reads horizontally - Comment / Approve / Changes as one row of pressable words - instead of a stacked vertical list, and the card shrinks by two rows.

- The diff review sheet now highlights the change within a modified line, not just the whole line: a deletion paired with its addition is word-diffed so the removed and added words keep the diff color while the unchanged part of the line dims. The plan tracked-changes view shares the same engine. Both are backed by a single whitespace-lossless word-diff (jsdiff diffWordsWithSpace), replacing the coarser home-grown LCS word diff, so quote anchors stay exact. In a multi-line hunk, lines are aligned to their real counterpart by similarity (not by position), so an inserted or removed line never paints a misleading word diff against an unrelated line.

  BREAKING (alpha): `@cueloop/schema` no longer exports `wordDiff` - it is superseded by the client-side word-diff engine and had no other consumer. `lcsDiff` (its building block) stays exported.

- Make the branded transparent theme readable on a light terminal. The default `cueloop` theme leaves the background unpainted so the terminal shows through, but its text was tuned only for a dark terminal - on a white background it rendered light-on-light (notably for a collaborator opening a shared plan over SSH). cueloop now queries the terminal's background at startup (OpenTUI's OSC theme-mode query, ~200ms budget, falling back to dark) and picks a light transparent variant with dark text when the terminal is light. Applies to both the local TUI and the SSH-served observer view. The opaque palette presets (Catppuccin, Nord, …) are unchanged - they paint their own background and already read the same either way.

- Render inline Markdown in the review surface. Prose now shows real emphasis - **strong**, _emphasis_, `code`, ~~strikethrough~~, and [links](url) - with the markup markers concealed, blockquotes muted, and headings bold with the level (h1/h2/h3) shown by descending brightness (a terminal cannot scale font size), leaving the salmon accent to annotations. Links become clickable OSC 8 terminal hyperlinks (http(s)/mailto only). The styling is produced by a new pure inline tokenizer in `@cueloop/schema` that emits each visible span at its exact source offset and drops the markers, so quote anchors, mouse selection, and keyboard-span selection stay character-precise - annotations resolve against the same text as before, and emphasis composes with word-diff on edited blocks.

- The marker popover now floats one row above the marked words, mapped through the word-wrap geometry, instead of drifting to the block's linear character offset; it paints over neighboring blocks and tracks the content when scrolled. A drag released outside a block's text (the gutter, past a line end, a gap between blocks) now still opens the span popover.

- Add a `build:binary` script that compiles cueloop into a self-contained executable with `bun build --compile`, bundling the Bun runtime so the binary needs neither Node nor a separate Bun. A release workflow builds one binary per platform (darwin-arm64, darwin-x64, linux-x64, linux-arm64) and attaches them, with a `checksums.txt`, to the GitHub Release. A curl installer served at `cueloop.dev/install.sh` and a Homebrew formula download those binaries, so `curl -fsSL https://cueloop.dev/install.sh | sh` and `brew install cueloop` install onto a stable PATH that survives Node version switches.

- The plan, diff, and review skills no longer block the agent on `session wait`. They submit the review, arm a detached `cueloop wake` that injects the verdict into the live session over the inbox socket, and end the turn - so the human keeps chatting while the review is open and the agent resumes itself when the verdict lands. A `session wait` fallback stays for sessions with no messaging inbox.

- Obsidian vault export: auto-detected vaults, filename templates with collision handling, provenance frontmatter, export on approve/resolve/manual.

- Upgrade OpenTUI to 0.5.1 (@opentui/core, @opentui/react, @opentui/ssh)

- The embedded Agent-tab terminal now drives its child through cueloop's own forkpty(3) FFI shim. The shim is a small `native/src/pty.zig` (spawn / non-blocking read / write / resize / reap) built by `build-pty.sh` with the same pinned Zig toolchain as the VT shim, loaded over `bun:ffi` from `packages/client/src/pty.ts`. This drops the last external native dependency, so all native code the client loads is now built and owned in-tree. Same graceful fallback as before: where no prebuilt shim ships for the platform, the launcher degrades to a herdr split. Verified end-to-end via the PTY e2e suite (alternate-screen render, raw-tty key routing, SIGWINCH resize, exit code).

- Read tarball contents from the archive itself during the publish check, instead of trusting `npm pack --json` whose output shape differs between npm majors.

- Every published package now carries a description, homepage, and issues link, so its npm page explains what it is and links back to the source. The release-integrity check enforces them.

- pi adapter: request_review tool blocking in-turn on the verdict with live progress, a pending-review write gate, and a /review command.

- The plan-mode gate is now the sole approval - no more double dialog. The `ExitPlanMode` hook was emitting a bare top-level `decision`, a shape Claude Code no longer recognizes, so it fell through to the native plan-approval dialog and you approved twice (once in cc's "approve / auto-accept" prompt, once in cueloop). The hook now returns the documented `hookSpecificOutput` PermissionRequest shape, which suppresses the native dialog: cueloop is the only place a plan is approved. To use vanilla plan mode, disable the plugin (`/plugin`, or `enabledPlugins: { "cueloop@cueloop": false }`).

- Code blocks in plans are now readable: lines render verbatim (indentation preserved, never word-wrapped) inside an elevated container with a language tag and tree-sitter syntax highlighting mapped to the theme tokens. Block spacing moved to a top-gap model, so code no longer glues to the list above it and headings always get breathing room.

- cueloop review <pr>: fetch a pull request via gh into a diff session and post the verdict back as a real PR review; adds --no-tui and review-post for scripting.

- Give the prototype comment composer a fixed width so it reads like the plan and diff composers instead of shrinking to its content. The floating card previously sized to the clicked element; it now uses a set width and stays inside the preview region when the element sits near the right edge.

- Anchor a prototype click on the interactive control it lands on. Clicking a button, link, or input inside a container (e.g. a button in a design-system grid) previously resolved to the nearest multi-child named container, so the marker popover floated over the container instead of the control. The resolver now returns the closest `button`/`a`/`[role=button]`/`input`/`select`/`textarea`/`label`/`summary` when the click is on one, falling back to the component-climb for generic content.

- Prototype review now renders the page. The screenshot is painted directly through the kitty graphics protocol into a reserved cell region (transmit once, re-place after each frame, beneath the text layer) rather than OpenTUI's image renderable, which stayed blank in some terminals; the capture viewport matches the box's cell aspect so the image fills it. Typing a comment no longer leaks to the global keymap - the compose textarea owns the keyboard while open and Enter saves. Adds an end-to-end test covering click -> actions bar -> comment -> save -> rail.

- Prototype review action popovers now paint their standard opaque background over the rendered page instead of letting the page show through.

- Make the prototype review surface fast and align its comment composer with plan mode. The screenshot is transmitted under one fixed kitty placement id so each frame replaces that placement instead of stacking a new one (the growing lag/ghosting on interaction); selecting an element no longer re-screenshots the page through Chromium (the popover is the selection feedback, as in plan mode); the divider drag only re-renders when the rail width actually changes a column; the headless Chromium is kept warm and reused across opens instead of cold-starting each time; the page load waits for `load` rather than `networkidle0`'s fixed idle window; the capture is sized to the region's real pixels; and an opt-in out-of-band file transfer (`CUELOOP_KITTY_FILE=1`, local only) sends the PNG as a temp-file path instead of base64 through the pty. The prototype composer now cancels on escape, matching the plan composer.

- Add prototype review: `cueloop prototype <file.html>` renders an HTML prototype with headless Chromium and shows it as an image in the review sheet. Click a rendered element - a design-system card, say - to select it (the click resolves to the nearest component element), and the marker actions bar and compose card annotate that element by CSS selector. The verdict feedback locates each comment by its selector. Needs a graphics-capable terminal (kitty or ghostty) and an installed Google Chrome; other terminals show a capability notice. A new `prototype` skill lets an agent submit a prototype for non-blocking review.

- Prototype review polish: the preview scrolls with the mouse wheel when the page overflows the box (the page scrolls and re-renders), the marker actions bar and compose card now sit on an opaque fill so they read as solid cards over the image, and the image is pulled while an app menu or settings overlay is open so those overlays no longer show through the graphics layer.

- Advertise the prototype review skill in the plugin: `/cueloop:prototype` now appears in the plugin and marketplace descriptions alongside plan, diff, review, and annotate.

- Render prototype mockups on the terminal's own surface. The mockup page's root background is no longer painted as an opaque box; the render is captured with an alpha channel, so a prototype emerges into whatever theme the terminal is running - its own components composited over the active surface - instead of floating in a fixed grey card.

- PTY test tier: the real TUI driven in a pseudo-terminal (render, key routing, resize, clean exit), env-gated.

- Published tarballs now carry resolvable dependency ranges. Internal dependencies were shipped as `workspace:*`, a package-manager protocol no npm client can resolve, so installing the published CLI failed. The version step now pins internal dependencies to the concrete lockstep version, and a pre-publish check packs every package and rejects unresolvable protocols or missing entry points.

- Collaborator names now reach the planner on pull. Pulling a shared plan merges the participant registry (union by id) alongside the collaborator notes, so a teammate who named themselves resolves to that name in the review rail instead of a raw SSH fingerprint. A collaborator who left a note without naming themselves reads as anonymous. The daemon's `session.mergeAnnotations` verb becomes `session.mergeShared`, carrying both the notes and the identities behind them.

- Bring color back to the review rail cards. A prior change had made a card's border wear its tone only while selected, so every unselected card faded to one dim gray - the rail read as colorless. Cards now always carry their color and selection reads from a filled background instead: your own comments are salmon, a share collaborator's comments are blue (matching the Comment verdict), and cuts are red. Blue and red are softened to pastels that sit with the salmon accent. The submit-review box wears a white border and title (its Submit button stays salmon), and the Agent-tab launcher buttons get white borders so they read against the transparent session.

- Harden refine's persisted state and skip-seen. `refine-state.json` and the `[cleanup] period_days` config value are now parsed with valibot instead of ad-hoc casts, so malformed state or a mistyped config value falls back cleanly. refine keys its skip-seen state on a per-session fingerprint (revision count, annotation count, resolved timestamp) rather than a bare id set, so a resolved session that is reopened and resolved again with new feedback is re-analyzed instead of being skipped forever.

- Bordered frames now read their corner style from one design-system token, `FRAME_BORDER_STYLE`, instead of each frame hardcoding its own value. Cards, dialogs, and the stories gallery chrome all resolve their rounded corners from this single source of truth, so the frame look can never drift between surfaces. Buttons stay text-first and borderless - the frame they sit in carries the border, not the button.

- The TUI splits into a review-session controller and a pure key reducer. session-controller.ts owns every daemon round-trip and mutation verb - connect/autostart/subscribe, the session/inbox/status snapshot, cut/edit/annotate/submit with both anchor constructions, the notes-vault export, and the post-submit hand-back including the herdr return-focus. keymap.ts turns the keyboard grammar into reduceKey(state, key) -> Intent[]: plan and diff reviews share one path for annotation navigation, deletion, and submit, and the observer read-only rule is one gate instead of three styles. App.tsx keeps only view state (cursor, span, overlays) and rendering; the whole grammar is now unit tested as a key table.

- The Share affordance moves out of the review rail and into the plan sheet header, inline next to Edit, with a plain "Share" label. It renders under the same owner-only gate as Edit, so `cueloop serve` observers and share collaborators still see neither button. The `⇧S` share keybinding and the underlying share intent are unchanged.

- The share toast now paints on the same solid dark panel as the Settings and Keybinds dialogs, so its text stays legible over the transparent session. Sharing a plan no longer also writes an inline "share link copied" line below the plan sheet - the centered toast is the single notification for the copied ssh line.

- One shared review core in @cueloop/daemon: openReview resolves the workspace, derives the title from the plan's first heading, and opens-or-revises by agent session id; ReviewHandle.awaitVerdict covers both the single long-poll and the chunked poll loop with progress and abort. The Claude Code hook, the pi extension, and the CLI commands (diff, review, session) now share this one path instead of five hand-built copies; workspace resolution has a single implementation, annotation ids come from one collision-safe helper in @cueloop/schema, and the adapter docs no longer claim a codex adapter that does not exist yet.

- Code blocks are syntax-highlighted with Shiki: TextMate-grammar tokens colored by a theme built from cueloop's own tokens, sixteen common languages loaded lazily on the first code block, verbatim rendering preserved, and unknown languages degrading to unstyled text.

- Shrink the extension-api seam to what a second integration actually needs. Delete the zero-caller loader.ts (extension discovery, repo-trust store) and trim the contract to the exporter surface every consumer uses: Registry captures an extension's exporters and isolates a throwing factory; the renderer/command/keybinding/listener hooks that no extension registered are gone. Decouple the session controller from the concrete Obsidian integration: a new client integrations.ts composes the configured integrations into generic BundledExporter values (an Exporter plus its per-verdict run policy), so the controller depends only on the extension seam, never on an integration's own config type. Adding a second markdown-vault exporter is now a small addition to that composer rather than a change to the controller. No behavior change.

- Fix: frames larger than the kernel socket buffer no longer truncate mid-line. Both the daemon and the client now honor socket backpressure - a partial write keeps its unwritten tail and flushes it on drain, so sessions with several revisions stay readable instead of wedging every request after the first oversized response.

- cueloop serve: share a session over SSH with read-only observers; the local TUI stays the single writable controller.

- Annotation and removal cards keep a transparent background when selected, so they sit flat on the transparent theme instead of painting an elevated fill. Selection now reads from the quote line taking the card's tone plus the matching document highlight. The submit-review card also drops its "N annotations · N blocking" line: the blocking count was always zero because nothing set an annotation's blocking flag, so the count and its plumbing are removed.

- Single-source the herdr env contract in @cueloop/schema (detectHerdr, insideHerdr, returnPaneFor) so the reviewer-side return-focus and the agent-side state reporting can no longer drift on which variables are required. focusHerdrPane now takes the herdr binary path as an argument, resolved once by the caller through detectHerdr, instead of re-reading HERDR_BIN_PATH with its own "herdr"-on-PATH fallback - so the reviewer side and the reporting side agree that the binary path is part of the contract. The two IO helpers stay with their sole consumers (focusHerdrPane in client, reportState/reportLabel in adapters). Narrow the @cueloop/daemon barrel to the two names imported bare (DaemonServer, cueloopHome); the client and review helpers keep coming through the ./client and ./review subpaths. No behavior change inside a herdr pane, where the binary path is always set.

- Validate the daemon's socket boundary with valibot: every request is checked before it reaches the session core, malformed input gets an `invalid_params` error naming the offending field, wait timeouts are clamped, and persisted session records are validated on recovery. Verdict kinds are closed; annotation kinds stay open for extensions.

- Document the npm install path (`npm i -g cueloop@alpha`) and stop the release verifier from failing on registry propagation lag: registry assertions now poll until they hold, so a CDN serving a stale document moments after a publish no longer looks like a broken release.

- The release lane now verifies the published result: every package must be on the registry at the released version, and the CLI must install from npm and run. A publish that reports success but leaves something unusable fails the release run instead of reaching users.

- The daemon's wire schemas are now exhaustiveness-checked against the types in @cueloop/schema, so a field added to a type without a matching mirror in the validation layer fails typecheck instead of being silently stripped at the socket boundary. This fixes the hook path dropping `meta.herdrPane` before it reached storage, which left the herdr return-focus feature dead. Round-trip and key-set pin tests guard the boundary at runtime too.

- Working-copy block surgery moves into schema: cutBlock, restoreBlock, restoreLine, and sourceChunk now live in @cueloop/schema/working-copy, the only module that slices raw source by block line ranges. restoreBlock also owns the pristine round-trip rule (returns undefined when the restore matches the submitted revision), so it is unit tested instead of living in a React callback. Behavior is unchanged.

- Build the embedded terminal FFI shim with a verified Zig toolchain and test its complete cell contract from source.
- Updated dependencies []:
  - @cueloop/schema@0.1.0-alpha.62
  - @cueloop/client@0.1.0-alpha.62
  - @cueloop/daemon@0.1.0-alpha.62
  - @cueloop/adapters@0.1.0-alpha.62

## 0.1.0-alpha.61

### Minor Changes

- Annotations now resolve when a revision addresses them, so re-review shows only what is still open. The feedback document lists each annotation's id and teaches the agent to report what it acted on (`cueloop session submit-revision <id> --addressed <id,id>`); reported annotations are marked addressed by that revision. As an assist, a plan revision that removed an annotation's quoted text marks it addressed too ("drift"). Addressed annotations leave the rail (a dim `✓ N addressed by revision` line keeps the count), lose their document highlight, stop counting toward the pending badge and the verdict default, and stay out of the next feedback document - but they are never deleted from the session record.

- Turn the review rail's Agent tab into a bring-your-own-harness launcher. It now shows branded claude code / pi / codex cards; clicking one runs that harness in a herdr split beside the review, so a reviewer can ask an agent about the plan without leaving the tab. A plan-context toggle seeds a briefing (read the plan, comment via `session annotate`, do not rewrite) into the launched split. The old dead agent/status/revision placeholder becomes a compact footer line.

- Widen the annotation surface so review-side agents write the same authored, span-anchored comment a human does. `session annotate` now takes `--author` (and `--author-name`, which registers the collaborator's display name in the participant registry) and `--action <index|name>`, which expands a shared quick-action preset into the comment body. A new `cueloop actions list` prints that vocabulary so an agent can reference a preset by name. The built-in quick actions now ship with a system-prompt sentence each. A new `cueloop:annotate` skill wraps read-plus-comment for any bring-your-own harness, documenting the quote-exact anchor contract and the annotate-only rights boundary.

- Near-live sync for shared plans. While you have a plan you shared open, cueloop now re-pulls collaborator notes every few seconds, so a teammate's comments stream in without reopening anything. It is bidirectional: your own notes and edits on a shared plan mirror up to the share, so collaborators see them on their next refresh. Everything still converges by id, so order never matters and there is nothing to resolve by hand.

- Name and manage collaborators. A share viewer is asked for a display name the first time they open a shared plan, so their notes attribute to a name rather than an SSH fingerprint; skipping keeps them anonymous, and a name from a past visit is remembered. The planner can rename any collaborator from the rail - r on a selected note, or activate the note (click it again, or e) - stored per fingerprint in the user config. The inbox gains a delete action (d, or the [delete] button) behind a centered confirm dialog, so finished plans can be cleared.

- The annotation composer now follows the Slack newline convention. Plain Enter still saves the note, while Option/Alt+Enter (and Shift+Enter, as before) insert a newline so you can write a multi-line comment without leaving the box; Cmd/Ctrl+Enter is a submit alias. The input also auto-grows as you type: a long line that soft-wraps expands the box the same way a hard newline does, up to four rows, after which it scrolls internally and keeps the caret line in view.

- Rejected diff hunks and cut plan blocks now appear in the review rail as their own cards, interleaved with annotation cards in reading order rather than grouped at the bottom. Each removal card previews the removed content struck through and dimmed; selecting one reveals its source line and shows an undo button (the same restore path as the `u` key), so a rejection reads like any other queued item you can take back before you submit. Inline, a cut span is now simply struck through and grayed rather than boxed with a `[cut]` tag, and saved annotation cards carry a uniform bordered frame titled `ACTION · author`. The composer's Cancel button drops its redundant ` esc` hint (esc still cancels).

  Keyboard scrolling in the diff sheet is now smooth: the layout model counted a wrapped annotation body or file header as one row while it rendered as several, so the cursor-follow scroll drifted and shifted the view. Those content lines no longer wrap, so the scroll target matches the real layout and the cursor holds a stable screen row.

- Enforce owner / collaborator / agent roles at the daemon socket. A connection is the owner by default (local single-user is unchanged); a review-side agent connects with `--role agent` (a `daemon.hello` handshake), and the daemon then caps it to reading the session and adding annotations - any attempt to resolve, submit a revision, edit, cut, share, or delete is refused. The capability map is one source of truth (`capabilities.ts`). The `cueloop:annotate` skill now passes `--role agent`, so a bring-your-own agent literally cannot escalate.

- Annotations collapse to a single `comment` kind. The `s` suggest keybinding is gone (the key is now unbound), and the suggestion "Replace/With" feedback rendering is removed - every annotation serializes as a comment. Working-copy edits and hunk curation already give a stronger, directly-applied way to propose a concrete change, so the suggestion kind was redundant.

  BREAKING (alpha) for `@cueloop/schema`: `AnnotationKind` no longer lists `"suggestion"`. The kind set stays open (`"comment" | (string & {})`) for forward-compat with agent notes and other kinds.

- Run the review agent inside the Agent tab, not a separate pane. Picking claude code / pi / codex now embeds a real terminal in the rail: the harness runs on a PTY through Ghostty's own VT core (libghostty-vt via a small FFI shim) and paints into the OpenTUI canvas cell-by-cell, with colors, text attributes, and a live cursor. While it is focused the keyboard routes to the agent; ctrl+] detaches back to the review. Where no prebuilt libghostty-vt ships for the platform, it falls back to the previous herdr-split launch, so nothing breaks. Ships a darwin-arm64 prebuilt today; other platforms use the split until their prebuilts land.

- Add an opt-in Prometheus `/metrics` endpoint to the sharing gateway (ADR 0007, Layer 2). Off by default and bound to loopback - it starts only when `CUELOOP_METRICS_PORT` is set, so it never faces the public port and production is unchanged until an operator opts in. It exposes share-verb success/error counts + latency (`cueloop_share_ops_total`, `cueloop_share_op_duration_seconds`) and R2 operation outcomes (`cueloop_r2_ops_total`), the SLIs a scraping agent (e.g. Grafana Cloud) needs. Box CPU/mem/disk stay the agent's node integration.

- Guided walk for diff reviews: press w in a diff session to step through every
  changed file as a focused card wizard with a plain step count. ] advances and
  marks the file viewed (persisted with the session, so a resumed review keeps
  its progress), [ steps back, esc leaves keeping progress, and the end card
  offers Submit review directly. Submitting agents can attach per-file notes
  (annotations with kind "note" anchored by the file path) that render in the
  wizard's agent-note block and as rail cards; notes are agent context and never
  come back as reviewer feedback. The submit confirm shows the honest viewed
  count for walked diff sessions.

- A review created from inside herdr now opens itself. When the Claude Code hook or `cueloop session create` starts a genuinely new review from a herdr pane, cueloop opens a fresh herdr tab, focuses it, and launches the review in it - no more copying a command out of the log by hand. A resubmit reuses the pane the original review already opened, so revisions never spam new tabs. It stays best-effort like the rest of the herdr tier: a missing or broken herdr binary is swallowed and never blocks the review, and outside herdr nothing changes.

- Add the marker-actions popover to plan review: marking a span (`v`) now shows an inline toolbar at the block - `comment · cut · actions · [x]` - each label keyboard-shortcut-backed and clickable, so span mode is discoverable rather than blind. `a` opens a quick-actions list of preset comments you pick with `j`/`k` and `⏎` (or a click), inserting the prompt as a comment on the span in one step; `x` cuts the whole block the span sits in. The list is configurable through a new `[[actions]]` config section (`prompt` plus optional `metadata`); defining any replaces the built-in review prompts. A mouse drag-select on a plan also opens the popover at the dragged range - one marker at a time.

- The automatic plan-mode gate (the `ExitPlanMode` hook) is now non-blocking. Instead of freezing the turn until the reviewer decides, it opens the review, arms a detached inbox waiter, and denies the exit immediately - so the agent ends its turn and you keep chatting while the plan is open. When you submit a verdict cueloop injects it into the live session; on approval the agent presents the same plan again and is allowed through. This closes the last place plan review still blocked the agent.

- Non-blocking review with a per-harness wake (ADR 0008). A plan can now be submitted without freezing the agent's turn: the human keeps chatting while the plan is open, and when they return a verdict cueloop resumes the driving agent with the feedback instead of relying on the harness to re-poll a blocked tool.

  - daemon: a new `awaitResolve(client, sessionId)` seam parks on one session's verdict from a session id alone (no ReviewHandle needed), so any background waiter can collect the outcome; the held connection and the pending session both keep the daemon off its idle-exit path for the whole wait.
  - pi: the `request_review` tool returns immediately with the session id and a background waiter injects the verdict with `sendUserMessage(deliverAs: "followUp")` when it lands; the pending-review write gate still holds mutating tools, and session shutdown aborts any waiter still parked.
  - Claude Code: a detached inbox waiter posts the verdict into the live session over `CLAUDE_CODE_MESSAGING_SOCKET` (the frame matched to Claude Code's own example), which Claude reads between tool calls or as a fresh turn when idle. The blocking ExitPlanMode gate is unchanged.
  - Codex: a detached waiter queues the verdict into the running thread via `codex queue` (app-server `thread/queue/add`), which auto-submits when the thread next goes idle. Weakest of the three paths - it needs Codex under the shared app-server daemon and still wants live-codex QA.

- Plan review surface v2: selection is the entry primitive (mouse drag or keyboard span on one native renderer selection), the compose box opens inline under the anchor instead of the bottom bar, annotation text lives in the rail while the document keeps only the kind-colored highlight, rail cards edit in place, and exiting the editor hand-off re-anchors every annotation - orphaned ones are flagged in the rail with a one-line reconciliation banner above the sheet.

- Pull collaborator notes on a shared plan back to the planner. When you share a plan, cueloop now records the share id on the session; `cueloop share pull [session-id]` (and opening a shared plan in the TUI) fetches the share's current notes and unions them into your local plan by id, so teammates' comments show up without losing your own. The gateway lets only the fingerprint that created the share pull it back.

- Add a Settings "Actions" category to edit the quick-action vocabulary. Each quick action is a row whose prompt, when clicked, expands a focused input for its system prompt (the guidance appended when the action is used); a reset-to-defaults control and an add-action row bracket the list. Edits persist to `[[actions]]` in the user config, so the presets a human picks and the ones an agent references via `annotate --action` stay one shared, editable set.

- Attribute collaborator annotations in the review rail. A note pulled from a shared plan now renders as a bordered card titled with the author's handle (derived from their SSH fingerprint until display names are captured), so a teammate's notes stand out from your own - which stay borderless. Own-only rails are unchanged.

- The submit confirm now lives in the review rail: pressing submit expands the rail's Submit button into a bordered confirm card - honest counts (`N annotations · M blocking`), the Comment / Approve / Changes verdict selector (arrow keys or click), the optional summary input, and plain Submit / Cancel word-buttons - replacing the detached full-width bottom bar. The annotation stack above stays scrollable while the card is open, key hints stay in the status line, read-only observers never see the card, and the keybinding surface is unchanged.

- Add the `refine` primitive: `cueloop refine` reads the corpus of past review sessions and writes a Markdown report to `~/.cueloop/reports/` (latest `report.md` plus a timestamped copy). The report gives corpus stats, reviewer annotations grouped by kind with their session/primitive/verdict/week, and weekly volume; a run analyzes up to 200 unseen sessions and skips sessions with no annotation and no verdict. The `/cueloop:refine` skill drives the agent to group the annotations into named patterns and propose writebacks (to a skill, `AGENTS.md`, `CLAUDE.md`, or memory) for human approval via a plan review. Adds a `cleanupPeriodDays` retention window (default 30) read from `[cleanup] period_days`: the daemon prunes sessions past the window on startup, and `refine` prunes old reports.

- Add the `reply` primitive: `cueloop reply` opens the latest pending reply review (or one by id/title), and the `/cueloop:reply` skill submits the agent's previous message for line-level human review. A reply is a first-class markdown artifact type, so it renders through the plan sheet, derives its title from the first heading, and gets revision drift-assist - the plan-like behaviors now key on the shared `isMarkdownArtifact` predicate in `@cueloop/schema` rather than a `type === "plan"` literal. Content flows through the existing skill path (the agent writes its reply to a file and submits `--type reply`), so there is no transcript reader and no new daemon plumbing. The verdict rides the same non-blocking wake as plan reviews.

- The review panel now resizes and collapses so the plan gets the width it needs. It cycles through three states with `b`: expanded (the full annotation rail), compact (a narrow strip that keeps the count and one accent dot per annotation), and hidden (gone entirely, so the plan takes the full terminal, reopened with the same key and no leftover tab). Drag the single-column divider between the plan and the rail to resize the expanded width, or nudge it with `[` and `]`; the divider accents while you drag and the width is clamped to a sensible range. A muted chevron on the panel's edge toggles expanded and compact with a click (`»` to collapse, `«` to expand). The collapse state and rail width persist to `[ui] review_state` and `[ui] review_width` in your config, so the layout you pick survives a restart.

- First alpha of the terminal review surface: the ReviewSession primitive end to end - plan review round-trip with Claude Code (annotate, span-select, Cut, $EDITOR edits, verdict + feedback.md), working-tree diff review, the inbox, a lazy unix-socket daemon with resumable waits, the typed extension API with trusted repo loading, layered TOML config with rebindable keys, and the Claude Code plugin packaging (/cueloop:plan, /cueloop:diff, /cueloop:review).

- SSH plan sharing: `cueloop share` (and a one-click Share button / ⇧S in the plan TUI) publishes a plan as one line - `ssh p_xxxxxxxx@cueloop.dev` - copied to the clipboard. A teammate pastes it and the plan renders in their terminal, no install, with every annotation already on it. They annotate too, and their notes union back into the shared blob attributed by SSH key, never overwriting the planner's. Backed by a new SSH gateway (raw ssh2, one port, shell renders / exec uploads) that seals each blob (AES-256-GCM, per-blob HKDF key) before it reaches R2. Annotations gain an optional `author` fingerprint; the review controller now renders the same TUI against a local session or a decrypted share.

- Pick a built-in color theme from Settings. A new Appearance tab cycles through the branded `cueloop` default (transparent, so your terminal background shows through) and five well-known palettes rendered from their first-party specs - Rosé Pine Moon, Catppuccin Mocha, Tokyo Night, Gruvbox Dark, and Nord - each painting its own opaque background. The choice applies live and persists to `[ui] theme` in your config; per-token `[theme]` overrides still layer on top of whichever preset you pick, so a hand-tuned accent survives a theme switch.

- The client UI is now a reusable component system. Every rendered surface lives in `components/` behind a strict tokens -> primitives -> domain layering, themed through a provider whose default is the built-in dark theme (config themes swap the provider; every component also takes a `theme` prop). Hand-rolled mechanisms were replaced with the documented terminal primitives: native word wrapping (quote anchors stay char-precise), a scrollable uncapped diff view with a real line-number gutter, multiline annotation composers (shift+enter for a new line), tree-sitter code highlighting, tab-strip rail tabs, a select-based verdict picker, suspend/resume around the `$EDITOR` hand-off, and responsive sizing from the terminal dimensions. Key bindings resolve through layered keymaps and the status-line hints are generated from the active bindings, so a rebound key shows its real binding. Each component ships stories; `bun run stories` browses them and the test suite snapshots every story.

- Opening a review is now verb-first: one verb per artifact type, each defaulting to the latest pending review of that type. `cueloop plan` opens the latest pending plan, `cueloop diff` opens the latest pending diff, and `cueloop review` opens the latest pending PR review. Each verb also addresses a specific session directly - `cueloop plan <session-id>` by id, or `cueloop plan <title>` by a case-insensitive title match (an exact title wins, a unique substring wins, and several matches list the candidates so you can name one). An explicit `--latest` (alias `--open`) always selects the default. The create paths stay: `cueloop diff` with a dirty working tree still creates a working-tree review, a clean tree opens the latest pending diff instead of erroring, and `cueloop review <pr>` still opens a pull request. Bare `cueloop` still opens the inbox and `cueloop <session-id>` still opens that session. A miss prints a plain "nothing to open" line instead of failing silently.

### Patch Changes

- Fix the Claude harness never launching from the Agent tab. Its command was `cc`, which is a personal shell alias for `claude` - but the embedded terminal spawns the binary directly on a PTY, where `cc` resolves to the system C compiler, so the pane ran the compiler instead of Claude Code (`pi` and `codex` are real binaries, so they worked). The command is now `claude`. Also strips the `▸` glyphs from the launcher buttons and plan-context toggle, and removes the inline `(⌃])` detach hint from the running-terminal header - the detach chord is now listed in the Keybinds cheatsheet (Settings) under "Agent terminal" instead. Detaching now tears the terminal down explicitly (the React reconciler detaches a child without destroying it), so the agent's child process no longer leaks after ctrl+].

- Tidy the Agent tab and rail width. The launcher is now three text-only buttons - "Claude Code", "Pi", "OpenAI Codex" - stacked tight without the ASCII logos, and all sharing one neutral color. Dropped the "Ask an agent about this plan" header and the bottom "<agent> · <status> · rev N" line (both redundant with the plan sheet header), so the buttons sit directly under the tabs. The rail also no longer indents its content: the tab body dropped a stray left padding (the Agent tab was indented two columns deeper than the Review tab) and the rail's own left padding, so annotation cards and the launcher buttons run full width from the divider seam.

- Stop annotations from orphaning when their quote carries a leading markdown marker, and re-bind lightly edited quotes. The parser strips block markers (`- `, `## `, `1. `, `> `) from block text, so a quote copied verbatim from the source - bullet and all - never matched the exact/trimmed lookup and dropped straight to an orphaned anchor. The anchor resolver now runs a longer cascade: exact -> trimmed -> marker-normalized -> fuzzy -> orphan. Marker stripping shares one `stripLeadingBlockMarker` utility with the parser so the two cannot drift, and the fuzzy tier (`levenshteinDistance` / `similarityRatio` / `fuzzyFindBestMatch`, standalone in `@cueloop/schema`) re-anchors a quote after a small edit, gated by a high similarity floor so it never binds to the wrong text. Fixing this in the resolver heals anchors already stored in a session and covers every author path (local, agent, gateway).

- Fix the Save and Cancel buttons in a saved annotation card's edit composer, which did nothing when clicked. The card is wrapped in a clickable box (`onMouseUp` selects/activates it), and a button press bubbled up to that box after firing, so activating the card immediately re-opened the editor and undid the action. Word-buttons now stop propagation on press, so a button inside any clickable surface consumes its own click instead of double-firing the ancestor.

- Annotation ids are unique by construction: a per-process counter joins the time component and the random suffix, so many ids minted on the same millisecond can never collide.

- Submitting a review now hands you back to the agent: a completion overlay confirms the verdict (and shows the vault-export path when one ran), offers to close, and can auto-close after a configurable delay - press `a` on the prompt once to opt in (persisted as `[ui] auto_close = 3`), set `0` for instant close, `"off"` to always be asked. `esc` stays in the resolved read-only view.

- Bump `diff` from 8.0.4 to 9.0.0. The client's intraline word-diff (`diffWordsWithSpace`) is unchanged and its tests plus the full suite pass; this also aligns the direct dependency with the `diff@9` that `@opentui/core` already resolves.

- Bump the `@opentui/*` group (core, react, keymap, ssh) from 0.5.1 to 0.5.2.

- Bump the `@opentui/*` group (core, react, keymap, ssh) to 0.5.8, aligned across the client and gateway. Keeping the whole group on one version collapses to a single `@opentui/core`, avoiding a dual-renderer install. Typecheck, the full test suite, and all render snapshots pass unchanged.

- [#287](https://github.com/mmurakaru/cueloop/pull/287) [`379e343`](https://github.com/mmurakaru/cueloop/commit/379e343c68e7057a3aee9dcfaea1d0c2a1ffae53) Thanks [@dependabot](https://github.com/apps/dependabot)! - Bump `@pierre/diffs` from 1.3.5 to 1.3.6. A patch release with no API change for the three call sites the client uses (`parsePatchFiles`, `parseDiffFromFile`, `diffAcceptRejectHunk`, `FileDiffMetadata`); typecheck, the diff projection and hunk-curation suites, and the full test run pass unchanged.

- `cueloop -v` / `cueloop --version` (and the bare `version` verb) now print the installed version and exit 0, instead of dumping the help text and exiting 2. `-h` is added as an alias for `--help`, and both are listed in the help output.

- The post-submit overlay is clearer: it counts down from 5 seconds by default (esc stays, a remembers the choice) instead of a static prompt, the action line reads as plain "label [key]" affordances with no glyphs (close [return] · closing in Ns · return to plan [esc] · always [a]), and the redundant verdict echo under the heading is gone.

- Test hardening: the inline-compose paint assertion waits on the span color instead of sampling the first frame after the keypress, which raced the anchor repaint on slow runners.

- [#290](https://github.com/mmurakaru/cueloop/pull/290) [`de64f99`](https://github.com/mmurakaru/cueloop/commit/de64f990647767f2482b90eadd283103979b63a2) Thanks [@mmurakaru](https://github.com/mmurakaru)! - Fix daemon autostart from the standalone binary. The client spawned `bun run main.ts` to launch the daemon, which only resolves from a source or npm install; a compiled binary (the curl and Homebrew install) has no `main.ts` on disk and its `execPath` is the cueloop binary rather than bun, so autostart failed with `daemon did not come up` whenever no daemon was already running - first launch, or after the daemon idle-exits. The client now detects the compiled binary via the Bun virtual-filesystem markers in `import.meta.url` and re-execs `cueloop daemon`.

- Guarantee one daemon per state directory. Concurrent autostarts previously raced: the second daemon unlinked the first one's socket and bound a fresh one, so two daemons served divergent in-memory sessions over the same files and a client could stop seeing sessions another had just created. Startup now takes an exclusive lock, a losing start exits quietly so the caller attaches to the live daemon, and stale locks from crashed daemons are reclaimed.

- A working-tree diff review now hot-reloads: while you have a `cueloop diff` session open, the daemon watches its repository and re-captures the diff whenever the working tree changes, so the review updates in place with no manual reload and no remount. Your annotations re-anchor across the refreshed patch through the usual anchor cascade. The daemon runs one recursive watcher per repository shared by its live diff sessions, debounces bursts of file writes into a single re-capture, ignores churn under `.git/` and `node_modules/`, and only broadcasts when the patch actually moved. A new owner-only `session.refreshDiff` verb is the seam the watcher drives and is scriptable on its own. Watching starts when a diff session is created (or recovered after a daemon restart) and stops when it resolves, is deleted, or the daemon shuts down.

- Diff hunk curation: while reviewing a working-tree diff, the owner can accept or reject individual hunks and changes in the terminal. `x` rejects (or restores) the change under the cursor, `⇧X` the whole hunk; rejected lines render struck through and dimmed. The curated result - the accepted changes only - becomes the review's working copy and flows to the agent as feedback, serialized as an exactly applyable unified diff.

  To make that exact, `cueloop diff` now captures the full old/new contents of every changed file (new optional `Artifact.files`), and curation re-parses each file with `@pierre/diffs` so a reject reverts precisely the chosen hunk or change. PR reviews carry a partial patch with no file contents, so curation stays disabled there with a clear status message.

- The diff review sheet now syntax-highlights code with tree-sitter: keywords, types, strings, and the rest wear their theme colors across context, added, and deleted lines, resolved off the render path so rows draw unstyled first. It composes with the intra-line word diff - a changed word keeps the diff color on top of its syntax color - and leaves the row-level annotation cards untouched. A hunk is highlighted as a contiguous fragment (so multi-line constructs tokenize correctly) and the filetype comes from the file path.

- Rename internals so every identifier states what it does: diff op fields (kind/oldValue/newValue), diff row kinds, key intents, and abbreviated locals across all packages; remove dead code and stale comments. No behavior change.

- Point the alpha dist-tag at the published release. Prereleases were landing on `latest` while `alpha` kept pointing at the first (broken) publish, so `npm i cueloop@alpha` served the wrong build; the release lane now retags every package and the verification step checks the tag a stranger would install, not just the exact version.

- Make the end-to-end suite deadline-based instead of iteration-based, so a cold CI runner paying for a subprocess and daemon start is not mistaken for a failure.

- Edit mode now works for every reviewer, in any shell. The editor resolves through `[ui] editor` config, then `$CUELOOP_EDITOR`/`$VISUAL`/`$EDITOR`, then a `nano` fallback, so a clean environment can still edit a plan (it used to throw). Known GUI editors get their wait flag applied automatically (`code --wait`, `subl --new-window --wait`, `zed --wait`, ...), and any editor that returns instantly with the file untouched drops to a confirm gate on the released terminal ("save and close it, then press Enter") instead of silently discarding the edit. Terminal editors are trusted to hold the terminal and never see the gate.

- Enforce a cyclomatic complexity limit of 20 (oxlint) and refactor the functions that exceeded it - the intent dispatcher, keymap reducer, config layering, App, plan-sheet run-style, the CLI command routers, and the daemon dispatch - into small, table-driven units. Behavior and public APIs are unchanged.

- Gateway connection-error logging is now classified: expected transport failures (bad handshake, auth abort, connection reset) from internet scanners on port 22 log one terse line instead of a full stack trace, while genuinely unexpected errors stay loud. Cuts log noise without hiding real faults.

- Fix the gateway leaving a collaborator's terminal in mouse-reporting mode. Quitting a shared plan now restores the terminal (disables mouse reporting, shows the cursor, leaves the alt screen) before the channel closes, so the local terminal no longer spews raw SGR mouse reports on every mouse move until `reset`. Previously the restore only ran after the channel had already closed, which dropped the bytes.

- `cueloop --help` now prints a grouped catalogue instead of a flat wall: the everyday verbs (`plan`, `diff`, `review`) sit under "common commands", with "share", "open a specific review", and "scripting" following. The command coverage is unchanged - the same entries, just organized so the common path is what you see first.

- Fix herdr tab auto-open: a review created inside a herdr pane now opens a new tab rendering it, as intended. `detectHerdr` required `HERDR_BIN_PATH`, which herdr 0.8+ does not set - it exposes `HERDR_SOCKET_PATH` and the `herdr` CLI on PATH - so detection silently failed and the auto-open (and agent-state reporting) no-op'd. `detectHerdr` now needs only `HERDR_ENV=1` + `HERDR_PANE_ID` and defaults the binary to `herdr` on PATH; an explicit `HERDR_BIN_PATH` still wins.

- First-class herdr hand-back: a review opened beside an agent now returns focus to the agent's pane when it closes. The adapter records the agent's pane on the session, and inside herdr the post-submit overlay defaults to a short countdown ("returning to claude-code") instead of a prompt; CUELOOP_RETURN_PANE overrides the target, and an explicit auto_close config still wins.

- Fixed herdr auto-open silently doing nothing. The `tab create` response parser expected `result.pane.id`, but real herdr (0.8.0) returns `result.root_pane.pane_id` - so a review created inside herdr never actually opened its tab. Verified against the real binary; the test stub now mirrors the real output shape.

- Re-planning in the same session now reliably shows the review in a herdr tab. Before, the auto-tab opened only for a brand-new review, so a resubmit whose original tab had been closed left an orphaned pending review with nothing on screen. cueloop now records the exact tab it opened (tab id + root pane id) in a herdr-namespaced daemon side-store - the core session model stays herdr-free - and on a resubmit checks that pane's liveness by id: a still-open tab is focused, a closed one is reopened, so there is never a duplicate and never a missing tab. Collision-free because it tracks the real ids, not a label.

- Fix the plan-gate review opening no herdr tab when the daemon is stale. Recalling the recorded tab handle from the daemon is now isolated from the tab-open flow, so a daemon that predates the herdr-tab verbs (or any recall failure) degrades to opening a fresh tab instead of silently opening nothing. The store write is likewise best-effort: a failure loses only the liveness-dedup handle, never the already-open tab.

- herdr tier-1 integration: panes report blocked/working state and review labels through the env contract; silent outside herdr.

- A plan shared over SSH now hides every plan-edit affordance from the viewer: the sheet-header Edit button is owner-only, the edit/cut keys are silent instead of nagging "shared plan - edit it in your own copy", and the hint strip drops cut/edit/submit. A collaborator still annotates, navigates, and edits their own notes.

- An adapter failure can no longer wedge the agent: whatever goes wrong inside cueloop, the hook emits a valid response carrying the reason instead of dying silently. Daemon autostart also waits longer (and reports why it gave up) so a cold or loaded machine is not mistaken for a broken daemon.

- The verdict selector in the submit confirm card reads horizontally - Comment / Approve / Changes as one row of pressable words - instead of a stacked vertical list, and the card shrinks by two rows.

- The diff review sheet now highlights the change within a modified line, not just the whole line: a deletion paired with its addition is word-diffed so the removed and added words keep the diff color while the unchanged part of the line dims. The plan tracked-changes view shares the same engine. Both are backed by a single whitespace-lossless word-diff (jsdiff diffWordsWithSpace), replacing the coarser home-grown LCS word diff, so quote anchors stay exact. In a multi-line hunk, lines are aligned to their real counterpart by similarity (not by position), so an inserted or removed line never paints a misleading word diff against an unrelated line.

  BREAKING (alpha): `@cueloop/schema` no longer exports `wordDiff` - it is superseded by the client-side word-diff engine and had no other consumer. `lcsDiff` (its building block) stays exported.

- Make the branded transparent theme readable on a light terminal. The default `cueloop` theme leaves the background unpainted so the terminal shows through, but its text was tuned only for a dark terminal - on a white background it rendered light-on-light (notably for a collaborator opening a shared plan over SSH). cueloop now queries the terminal's background at startup (OpenTUI's OSC theme-mode query, ~200ms budget, falling back to dark) and picks a light transparent variant with dark text when the terminal is light. Applies to both the local TUI and the SSH-served observer view. The opaque palette presets (Catppuccin, Nord, …) are unchanged - they paint their own background and already read the same either way.

- Render inline Markdown in the review surface. Prose now shows real emphasis - **strong**, _emphasis_, `code`, ~~strikethrough~~, and [links](url) - with the markup markers concealed, blockquotes muted, and headings bold with the level (h1/h2/h3) shown by descending brightness (a terminal cannot scale font size), leaving the salmon accent to annotations. Links become clickable OSC 8 terminal hyperlinks (http(s)/mailto only). The styling is produced by a new pure inline tokenizer in `@cueloop/schema` that emits each visible span at its exact source offset and drops the markers, so quote anchors, mouse selection, and keyboard-span selection stay character-precise - annotations resolve against the same text as before, and emphasis composes with word-diff on edited blocks.

- The marker popover now floats one row above the marked words, mapped through the word-wrap geometry, instead of drifting to the block's linear character offset; it paints over neighboring blocks and tracks the content when scrolled. A drag released outside a block's text (the gutter, past a line end, a gap between blocks) now still opens the span popover.

- Add a `build:binary` script that compiles cueloop into a self-contained executable with `bun build --compile`, bundling the Bun runtime so the binary needs neither Node nor a separate Bun. A release workflow builds one binary per platform (darwin-arm64, darwin-x64, linux-x64, linux-arm64) and attaches them, with a `checksums.txt`, to the GitHub Release. A curl installer served at `cueloop.dev/install.sh` and a Homebrew formula download those binaries, so `curl -fsSL https://cueloop.dev/install.sh | sh` and `brew install cueloop` install onto a stable PATH that survives Node version switches.

- The plan, diff, and review skills no longer block the agent on `session wait`. They submit the review, arm a detached `cueloop wake` that injects the verdict into the live session over the inbox socket, and end the turn - so the human keeps chatting while the review is open and the agent resumes itself when the verdict lands. A `session wait` fallback stays for sessions with no messaging inbox.

- Obsidian vault export: auto-detected vaults, filename templates with collision handling, provenance frontmatter, export on approve/resolve/manual.

- Upgrade OpenTUI to 0.5.1 (@opentui/core, @opentui/react, @opentui/ssh)

- The embedded Agent-tab terminal now drives its child through cueloop's own forkpty(3) FFI shim. The shim is a small `native/src/pty.zig` (spawn / non-blocking read / write / resize / reap) built by `build-pty.sh` with the same pinned Zig toolchain as the VT shim, loaded over `bun:ffi` from `packages/client/src/pty.ts`. This drops the last external native dependency, so all native code the client loads is now built and owned in-tree. Same graceful fallback as before: where no prebuilt shim ships for the platform, the launcher degrades to a herdr split. Verified end-to-end via the PTY e2e suite (alternate-screen render, raw-tty key routing, SIGWINCH resize, exit code).

- Read tarball contents from the archive itself during the publish check, instead of trusting `npm pack --json` whose output shape differs between npm majors.

- Every published package now carries a description, homepage, and issues link, so its npm page explains what it is and links back to the source. The release-integrity check enforces them.

- pi adapter: request_review tool blocking in-turn on the verdict with live progress, a pending-review write gate, and a /review command.

- The plan-mode gate is now the sole approval - no more double dialog. The `ExitPlanMode` hook was emitting a bare top-level `decision`, a shape Claude Code no longer recognizes, so it fell through to the native plan-approval dialog and you approved twice (once in cc's "approve / auto-accept" prompt, once in cueloop). The hook now returns the documented `hookSpecificOutput` PermissionRequest shape, which suppresses the native dialog: cueloop is the only place a plan is approved. To use vanilla plan mode, disable the plugin (`/plugin`, or `enabledPlugins: { "cueloop@cueloop": false }`).

- Code blocks in plans are now readable: lines render verbatim (indentation preserved, never word-wrapped) inside an elevated container with a language tag and tree-sitter syntax highlighting mapped to the theme tokens. Block spacing moved to a top-gap model, so code no longer glues to the list above it and headings always get breathing room.

- cueloop review <pr>: fetch a pull request via gh into a diff session and post the verdict back as a real PR review; adds --no-tui and review-post for scripting.

- Give the prototype comment composer a fixed width so it reads like the plan and diff composers instead of shrinking to its content. The floating card previously sized to the clicked element; it now uses a set width and stays inside the preview region when the element sits near the right edge.

- Anchor a prototype click on the interactive control it lands on. Clicking a button, link, or input inside a container (e.g. a button in a design-system grid) previously resolved to the nearest multi-child named container, so the marker popover floated over the container instead of the control. The resolver now returns the closest `button`/`a`/`[role=button]`/`input`/`select`/`textarea`/`label`/`summary` when the click is on one, falling back to the component-climb for generic content.

- Prototype review now renders the page. The screenshot is painted directly through the kitty graphics protocol into a reserved cell region (transmit once, re-place after each frame, beneath the text layer) rather than OpenTUI's image renderable, which stayed blank in some terminals; the capture viewport matches the box's cell aspect so the image fills it. Typing a comment no longer leaks to the global keymap - the compose textarea owns the keyboard while open and Enter saves. Adds an end-to-end test covering click -> actions bar -> comment -> save -> rail.

- Prototype review action popovers now paint their standard opaque background over the rendered page instead of letting the page show through.

- Make the prototype review surface fast and align its comment composer with plan mode. The screenshot is transmitted under one fixed kitty placement id so each frame replaces that placement instead of stacking a new one (the growing lag/ghosting on interaction); selecting an element no longer re-screenshots the page through Chromium (the popover is the selection feedback, as in plan mode); the divider drag only re-renders when the rail width actually changes a column; the headless Chromium is kept warm and reused across opens instead of cold-starting each time; the page load waits for `load` rather than `networkidle0`'s fixed idle window; the capture is sized to the region's real pixels; and an opt-in out-of-band file transfer (`CUELOOP_KITTY_FILE=1`, local only) sends the PNG as a temp-file path instead of base64 through the pty. The prototype composer now cancels on escape, matching the plan composer.

- Add prototype review: `cueloop prototype <file.html>` renders an HTML prototype with headless Chromium and shows it as an image in the review sheet. Click a rendered element - a design-system card, say - to select it (the click resolves to the nearest component element), and the marker actions bar and compose card annotate that element by CSS selector. The verdict feedback locates each comment by its selector. Needs a graphics-capable terminal (kitty or ghostty) and an installed Google Chrome; other terminals show a capability notice. A new `prototype` skill lets an agent submit a prototype for non-blocking review.

- Prototype review polish: the preview scrolls with the mouse wheel when the page overflows the box (the page scrolls and re-renders), the marker actions bar and compose card now sit on an opaque fill so they read as solid cards over the image, and the image is pulled while an app menu or settings overlay is open so those overlays no longer show through the graphics layer.

- Advertise the prototype review skill in the plugin: `/cueloop:prototype` now appears in the plugin and marketplace descriptions alongside plan, diff, review, and annotate.

- Render prototype mockups on the terminal's own surface. The mockup page's root background is no longer painted as an opaque box; the render is captured with an alpha channel, so a prototype emerges into whatever theme the terminal is running - its own components composited over the active surface - instead of floating in a fixed grey card.

- PTY test tier: the real TUI driven in a pseudo-terminal (render, key routing, resize, clean exit), env-gated.

- Published tarballs now carry resolvable dependency ranges. Internal dependencies were shipped as `workspace:*`, a package-manager protocol no npm client can resolve, so installing the published CLI failed. The version step now pins internal dependencies to the concrete lockstep version, and a pre-publish check packs every package and rejects unresolvable protocols or missing entry points.

- Collaborator names now reach the planner on pull. Pulling a shared plan merges the participant registry (union by id) alongside the collaborator notes, so a teammate who named themselves resolves to that name in the review rail instead of a raw SSH fingerprint. A collaborator who left a note without naming themselves reads as anonymous. The daemon's `session.mergeAnnotations` verb becomes `session.mergeShared`, carrying both the notes and the identities behind them.

- Bring color back to the review rail cards. A prior change had made a card's border wear its tone only while selected, so every unselected card faded to one dim gray - the rail read as colorless. Cards now always carry their color and selection reads from a filled background instead: your own comments are salmon, a share collaborator's comments are blue (matching the Comment verdict), and cuts are red. Blue and red are softened to pastels that sit with the salmon accent. The submit-review box wears a white border and title (its Submit button stays salmon), and the Agent-tab launcher buttons get white borders so they read against the transparent session.

- Harden refine's persisted state and skip-seen. `refine-state.json` and the `[cleanup] period_days` config value are now parsed with valibot instead of ad-hoc casts, so malformed state or a mistyped config value falls back cleanly. refine keys its skip-seen state on a per-session fingerprint (revision count, annotation count, resolved timestamp) rather than a bare id set, so a resolved session that is reopened and resolved again with new feedback is re-analyzed instead of being skipped forever.

- Bordered frames now read their corner style from one design-system token, `FRAME_BORDER_STYLE`, instead of each frame hardcoding its own value. Cards, dialogs, and the stories gallery chrome all resolve their rounded corners from this single source of truth, so the frame look can never drift between surfaces. Buttons stay text-first and borderless - the frame they sit in carries the border, not the button.

- The TUI splits into a review-session controller and a pure key reducer. session-controller.ts owns every daemon round-trip and mutation verb - connect/autostart/subscribe, the session/inbox/status snapshot, cut/edit/annotate/submit with both anchor constructions, the notes-vault export, and the post-submit hand-back including the herdr return-focus. keymap.ts turns the keyboard grammar into reduceKey(state, key) -> Intent[]: plan and diff reviews share one path for annotation navigation, deletion, and submit, and the observer read-only rule is one gate instead of three styles. App.tsx keeps only view state (cursor, span, overlays) and rendering; the whole grammar is now unit tested as a key table.

- The Share affordance moves out of the review rail and into the plan sheet header, inline next to Edit, with a plain "Share" label. It renders under the same owner-only gate as Edit, so `cueloop serve` observers and share collaborators still see neither button. The `⇧S` share keybinding and the underlying share intent are unchanged.

- The share toast now paints on the same solid dark panel as the Settings and Keybinds dialogs, so its text stays legible over the transparent session. Sharing a plan no longer also writes an inline "share link copied" line below the plan sheet - the centered toast is the single notification for the copied ssh line.

- One shared review core in @cueloop/daemon: openReview resolves the workspace, derives the title from the plan's first heading, and opens-or-revises by agent session id; ReviewHandle.awaitVerdict covers both the single long-poll and the chunked poll loop with progress and abort. The Claude Code hook, the pi extension, and the CLI commands (diff, review, session) now share this one path instead of five hand-built copies; workspace resolution has a single implementation, annotation ids come from one collision-safe helper in @cueloop/schema, and the adapter docs no longer claim a codex adapter that does not exist yet.

- Code blocks are syntax-highlighted with Shiki: TextMate-grammar tokens colored by a theme built from cueloop's own tokens, sixteen common languages loaded lazily on the first code block, verbatim rendering preserved, and unknown languages degrading to unstyled text.

- Shrink the extension-api seam to what a second integration actually needs. Delete the zero-caller loader.ts (extension discovery, repo-trust store) and trim the contract to the exporter surface every consumer uses: Registry captures an extension's exporters and isolates a throwing factory; the renderer/command/keybinding/listener hooks that no extension registered are gone. Decouple the session controller from the concrete Obsidian integration: a new client integrations.ts composes the configured integrations into generic BundledExporter values (an Exporter plus its per-verdict run policy), so the controller depends only on the extension seam, never on an integration's own config type. Adding a second markdown-vault exporter is now a small addition to that composer rather than a change to the controller. No behavior change.

- Fix: frames larger than the kernel socket buffer no longer truncate mid-line. Both the daemon and the client now honor socket backpressure - a partial write keeps its unwritten tail and flushes it on drain, so sessions with several revisions stay readable instead of wedging every request after the first oversized response.

- cueloop serve: share a session over SSH with read-only observers; the local TUI stays the single writable controller.

- Annotation and removal cards keep a transparent background when selected, so they sit flat on the transparent theme instead of painting an elevated fill. Selection now reads from the quote line taking the card's tone plus the matching document highlight. The submit-review card also drops its "N annotations · N blocking" line: the blocking count was always zero because nothing set an annotation's blocking flag, so the count and its plumbing are removed.

- Single-source the herdr env contract in @cueloop/schema (detectHerdr, insideHerdr, returnPaneFor) so the reviewer-side return-focus and the agent-side state reporting can no longer drift on which variables are required. focusHerdrPane now takes the herdr binary path as an argument, resolved once by the caller through detectHerdr, instead of re-reading HERDR_BIN_PATH with its own "herdr"-on-PATH fallback - so the reviewer side and the reporting side agree that the binary path is part of the contract. The two IO helpers stay with their sole consumers (focusHerdrPane in client, reportState/reportLabel in adapters). Narrow the @cueloop/daemon barrel to the two names imported bare (DaemonServer, cueloopHome); the client and review helpers keep coming through the ./client and ./review subpaths. No behavior change inside a herdr pane, where the binary path is always set.

- Validate the daemon's socket boundary with valibot: every request is checked before it reaches the session core, malformed input gets an `invalid_params` error naming the offending field, wait timeouts are clamped, and persisted session records are validated on recovery. Verdict kinds are closed; annotation kinds stay open for extensions.

- Document the npm install path (`npm i -g cueloop@alpha`) and stop the release verifier from failing on registry propagation lag: registry assertions now poll until they hold, so a CDN serving a stale document moments after a publish no longer looks like a broken release.

- The release lane now verifies the published result: every package must be on the registry at the released version, and the CLI must install from npm and run. A publish that reports success but leaves something unusable fails the release run instead of reaching users.

- The daemon's wire schemas are now exhaustiveness-checked against the types in @cueloop/schema, so a field added to a type without a matching mirror in the validation layer fails typecheck instead of being silently stripped at the socket boundary. This fixes the hook path dropping `meta.herdrPane` before it reached storage, which left the herdr return-focus feature dead. Round-trip and key-set pin tests guard the boundary at runtime too.

- Working-copy block surgery moves into schema: cutBlock, restoreBlock, restoreLine, and sourceChunk now live in @cueloop/schema/working-copy, the only module that slices raw source by block line ranges. restoreBlock also owns the pristine round-trip rule (returns undefined when the restore matches the submitted revision), so it is unit tested instead of living in a React callback. Behavior is unchanged.

- Build the embedded terminal FFI shim with a verified Zig toolchain and test its complete cell contract from source.
- Updated dependencies []:
  - @cueloop/schema@0.1.0-alpha.61
  - @cueloop/client@0.1.0-alpha.61
  - @cueloop/daemon@0.1.0-alpha.61
  - @cueloop/adapters@0.1.0-alpha.61

## 0.1.0-alpha.60

### Minor Changes

- [#283](https://github.com/mmurakaru/cueloop/pull/283) [`ce3e837`](https://github.com/mmurakaru/cueloop/commit/ce3e837a52405e6386a140a3f6437ff0b36b76ee) Thanks [@mmurakaru](https://github.com/mmurakaru)! - Add the `reply` primitive: `cueloop reply` opens the latest pending reply review (or one by id/title), and the `/cueloop:reply` skill submits the agent's previous message for line-level human review. A reply is a first-class markdown artifact type, so it renders through the plan sheet, derives its title from the first heading, and gets revision drift-assist - the plan-like behaviors now key on the shared `isMarkdownArtifact` predicate in `@cueloop/schema` rather than a `type === "plan"` literal. Content flows through the existing skill path (the agent writes its reply to a file and submits `--type reply`), so there is no transcript reader and no new daemon plumbing. The verdict rides the same non-blocking wake as plan reviews.

### Patch Changes

- Updated dependencies []:
  - @cueloop/adapters@0.1.0-alpha.60
  - @cueloop/client@0.1.0-alpha.60
  - @cueloop/daemon@0.1.0-alpha.60
  - @cueloop/schema@0.1.0-alpha.60

## 0.1.0-alpha.59

### Patch Changes

- [#278](https://github.com/mmurakaru/cueloop/pull/278) [`8523940`](https://github.com/mmurakaru/cueloop/commit/852394000ba356c159b21097e46cf8036a6ebf21) Thanks [@mmurakaru](https://github.com/mmurakaru)! - Enforce a cyclomatic complexity limit of 20 (oxlint) and refactor the functions that exceeded it - the intent dispatcher, keymap reducer, config layering, App, plan-sheet run-style, the CLI command routers, and the daemon dispatch - into small, table-driven units. Behavior and public APIs are unchanged.

- Updated dependencies [[`8523940`](https://github.com/mmurakaru/cueloop/commit/852394000ba356c159b21097e46cf8036a6ebf21)]:
  - @cueloop/client@0.1.0-alpha.59
  - @cueloop/daemon@0.1.0-alpha.59
  - @cueloop/adapters@0.1.0-alpha.59
  - @cueloop/schema@0.1.0-alpha.59

## 0.1.0-alpha.58

### Patch Changes

- [#263](https://github.com/mmurakaru/cueloop/pull/263) [`d21e00c`](https://github.com/mmurakaru/cueloop/commit/d21e00c0a17fc1ba0712e4dcb077723d5cca04a0) Thanks [@mmurakaru](https://github.com/mmurakaru)! - Give the prototype comment composer a fixed width so it reads like the plan and diff composers instead of shrinking to its content. The floating card previously sized to the clicked element; it now uses a set width and stays inside the preview region when the element sits near the right edge.

- Updated dependencies []:
  - @cueloop/adapters@0.1.0-alpha.58
  - @cueloop/client@0.1.0-alpha.58
  - @cueloop/daemon@0.1.0-alpha.58
  - @cueloop/schema@0.1.0-alpha.58

## 0.1.0-alpha.57

### Patch Changes

- [#264](https://github.com/mmurakaru/cueloop/pull/264) [`8184f77`](https://github.com/mmurakaru/cueloop/commit/8184f772f94c39fd2341f58c5e0de3d42ac624a1) Thanks [@mmurakaru](https://github.com/mmurakaru)! - Anchor a prototype click on the interactive control it lands on. Clicking a button, link, or input inside a container (e.g. a button in a design-system grid) previously resolved to the nearest multi-child named container, so the marker popover floated over the container instead of the control. The resolver now returns the closest `button`/`a`/`[role=button]`/`input`/`select`/`textarea`/`label`/`summary` when the click is on one, falling back to the component-climb for generic content.

- Updated dependencies []:
  - @cueloop/adapters@0.1.0-alpha.57
  - @cueloop/client@0.1.0-alpha.57
  - @cueloop/daemon@0.1.0-alpha.57
  - @cueloop/schema@0.1.0-alpha.57

## 0.1.0-alpha.56

### Patch Changes

- [#266](https://github.com/mmurakaru/cueloop/pull/266) [`0c8f353`](https://github.com/mmurakaru/cueloop/commit/0c8f3534cd59be2c169d0ebc7cb820a49ff24d6d) Thanks [@mmurakaru](https://github.com/mmurakaru)! - Add a `build:binary` script that compiles cueloop into a self-contained executable with `bun build --compile`, bundling the Bun runtime so the binary needs neither Node nor a separate Bun. A release workflow builds one binary per platform (darwin-arm64, darwin-x64, linux-x64, linux-arm64) and attaches them, with a `checksums.txt`, to the GitHub Release. A curl installer served at `cueloop.dev/install.sh` and a Homebrew formula download those binaries, so `curl -fsSL https://cueloop.dev/install.sh | sh` and `brew install cueloop` install onto a stable PATH that survives Node version switches.

- Updated dependencies []:
  - @cueloop/adapters@0.1.0-alpha.56
  - @cueloop/client@0.1.0-alpha.56
  - @cueloop/daemon@0.1.0-alpha.56
  - @cueloop/schema@0.1.0-alpha.56

## 0.1.0-alpha.55

### Patch Changes

- [#265](https://github.com/mmurakaru/cueloop/pull/265) [`e5e3a9e`](https://github.com/mmurakaru/cueloop/commit/e5e3a9ee28f8fc6158d9eccb81b1a9afb2f95eb5) Thanks [@mmurakaru](https://github.com/mmurakaru)! - Render prototype mockups on the terminal's own surface. The mockup page's root background is no longer painted as an opaque box; the render is captured with an alpha channel, so a prototype emerges into whatever theme the terminal is running - its own components composited over the active surface - instead of floating in a fixed grey card.

- Updated dependencies []:
  - @cueloop/adapters@0.1.0-alpha.55
  - @cueloop/client@0.1.0-alpha.55
  - @cueloop/daemon@0.1.0-alpha.55
  - @cueloop/schema@0.1.0-alpha.55

## 0.1.0-alpha.54

### Patch Changes

- [#260](https://github.com/mmurakaru/cueloop/pull/260) [`e78fed9`](https://github.com/mmurakaru/cueloop/commit/e78fed908daacec20fefe382db5f980e880fe327) Thanks [@mmurakaru](https://github.com/mmurakaru)! - Make the branded transparent theme readable on a light terminal. The default `cueloop` theme leaves the background unpainted so the terminal shows through, but its text was tuned only for a dark terminal - on a white background it rendered light-on-light (notably for a collaborator opening a shared plan over SSH). cueloop now queries the terminal's background at startup (OpenTUI's OSC theme-mode query, ~200ms budget, falling back to dark) and picks a light transparent variant with dark text when the terminal is light. Applies to both the local TUI and the SSH-served observer view. The opaque palette presets (Catppuccin, Nord, …) are unchanged - they paint their own background and already read the same either way.

- Updated dependencies []:
  - @cueloop/adapters@0.1.0-alpha.54
  - @cueloop/client@0.1.0-alpha.54
  - @cueloop/daemon@0.1.0-alpha.54
  - @cueloop/schema@0.1.0-alpha.54

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
