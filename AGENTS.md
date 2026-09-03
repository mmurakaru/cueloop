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
