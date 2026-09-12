# cueloop agent notes

## purpose

- Terminal-first review surface for coding agents. The product is the primitive:
  a ReviewSession anyone can render, annotate, and extend.
- One loop: an agent submits an artifact and blocks; a human annotates and returns
  a verdict; annotations serialize into structured feedback the agent acts on.
- Canonical decisions live in the GitHub map issue (#1) and its closed tickets.
  Do not re-litigate closed decisions in code review.

## major dependencies

- [Bun](https://bun.sh) runtime and package manager (run-from-source, zero build)
- [OpenTUI](https://github.com/anomalyco/opentui) React terminal UI (`@opentui/core`, `@opentui/react`)
- [@pierre/diffs](https://www.npmjs.com/package/@pierre/diffs) diff data layer (parse only; rendering is ours)
- [Effect](https://effect.website) TypeScript standard library (`effect`); read the effect guidance below before writing Effect code

## architecture

```
packages/
  schema/         ReviewSession types, block model, anchors, diff, feedback.md.
                  Pure TS, zero deps. Imports nothing from other packages.
  daemon/         Socket server (NDJSON + events), session store, wait broker.
  client/         The TUI (OpenTUI React): shell, projection renderer, selection.
  extension-api/  The typed exporter contract for integrations.
  adapters/       claude-code hook, pi package, skills (codex planned).
  cli/            Entry points; `cueloop session *` mirrors the socket API 1:1.
```

Rules:
- `schema` is the root of the dependency graph; everything imports it, it imports nothing.
- The dependency direction is a check: `import-budgets.json` lists the workspace
  packages each package may import and the number of imports a module may have;
  `bun run lint` runs `scripts/check-import-budgets.ts` and fails on a reach down
  or a module over budget. Raise a budget in that file, not by widening a layer.
- `client` and `daemon` never import each other - they meet only at the socket protocol.
- All session mutation goes through the daemon; the client never touches session files.
- Renderers and panels are built-in components; the extension API exists for integrations to register exporters.
- One planning layer per user-visible structure: blocks, layout map, and selection
  derive from the same parse - never re-derive ad hoc.
- Anchors are quote-primary. Never silently bind an annotation to the wrong text;
  orphan it and say so.

## commands

- install deps: `bun install`
- run from source: `bun run packages/cli/src/main.ts`
- tests: `bun test ./packages`
- one package: `bun test ./packages/schema`
- PTY integration tests: `bun run test:pty` (Unix only, opt-in)
- typecheck: `bun run typecheck`

## testing

Four tiers, cheapest loop first (use the cheapest tier that can prove the change):
1. Colocated unit tests (`src/foo.ts` + `src/foo.test.ts`) - pure logic.
2. Virtual-terminal component tests (`@opentui/react/test-utils`: `testRender`,
   `captureCharFrame`, mock input) - every rendering or interaction change.
3. Daemon/session integration (`test/session/`) - cross-process flows over a real socket
   in a temp state dir.
4. PTY tests (`test/pty/`, env-gated) - resize, key routing, real terminal behavior.
   The TUI runs in a real pseudo terminal and its output is fed into the in-repo
   Ghostty VT emulator, so assertions read the rendered screen, never raw bytes.
   Harness: `test/helpers/pty-tui-session.ts` (`launchTuiSession`, `waitForReady`,
   `press`, `waitForText`, `waitForScreen`, `close`), key names in
   `test/helpers/pty-key-codes.ts`, ready-to-drive plan and diff reviews plus the
   tier gate in `test/helpers/pty-reviews.ts`; the daemon home fixture is
   `test/helpers/review-home.ts` and the git repo fixture `test/helpers/git-repo.ts`.
   Every PTY child gets a failing `ssh` first on PATH, so share chords never
   reach the live gateway from a test.

Readiness contract: the App fires one ready signal after the first frame that
paints a usable screen, by which point that screen's keyboard handlers are
subscribed (`packages/client/src/ready-signal.ts`). Surfaces that mount later
still need a screen predicate. In-process suites boot with `renderReadyApp`
from `test-support.ts`; subprocess and PTY suites set `CUELOOP_READY_FILE`
and wait for that file (`waitForReady`). Wait for readiness on the signal,
never on output silence or a sleep. CI runs the suite once: the retry loop had
not fired in the last 18 green runs, and a flaky test is a failing test.
   Set `CUELOOP_TEST_EXECUTABLE` to run the suite against a compiled binary
   instead of the source entry. `test/pty/keybindings.test.ts` covers every chord
   in the thread view cheatsheet tables and fails on a new chord without an
   expectation; runs in CI (`PTY tier` job) and in the release build.

Verification recipes:
- schema change → tier 1 + `bun run typecheck`.
- rendering/interaction change → tier 2 frame assertions; add tier 4 coverage for
  scrolling/resize/key-routing behavior.
- daemon/protocol change → tier 3 with a real socket round-trip.
- adapter change → the e2e round-trip test (hook → daemon → client → verdict → hook).
- Test helpers are named with `Test` (`createTestSession`) and live in `test/helpers/`.

## naming and style

- Plain dash in prose, never the em dash.
- Describe cueloop strictly on its own terms: never reference or compare to other
  products in docs, code, commits, or issues. Naming our own dependencies and
  integration targets (OpenTUI, @pierre/diffs, herdr, pi, Claude Code, Codex, Obsidian) is fine.
- Comments state intent and invariants, not narration.
- Blank-line padding: keep a blank line before every `return` and after a run of
  declarations. oxlint cannot enforce this yet (upstream oxc#479 for the rule,
  oxc#22053 for oxfmt); enable it in config once it lands.
- Keybindings/labels locked: deletion = Cut, submit = "Submit review (n)".

## releases

- Changesets drive versioning (alpha prerelease mode: versions like
  0.1.0-alpha.N under the `alpha` dist-tag). All packages version in lockstep.
- **Every PR ships a changeset**: `bunx changeset` (patch for fixes, minor for
  features; `bunx changeset --empty` for docs/CI-only changes). CI blocks PRs
  without one.
- Never edit CHANGELOG.md or package versions by hand - the Release PR does it.
- The Claude Code plugin manifest version syncs automatically during
  `bun run version` (scripts/sync-plugin-version.ts).

- Runtime validation uses **valibot** (not zod): modular and tree-shakeable,
  which matters for CLI startup latency. Validate at trust boundaries - the
  socket protocol and persisted records - not between internal modules.

## effect

The Effect TypeScript library (`effect`) is installed at the root. Before
writing any Effect code, read `node_modules/effect/AGENTS.md` in full and follow
its links. For apis the guide does not cover, search `node_modules/effect/src`.
