# cueloop

[![npm](https://img.shields.io/npm/v/cueloop/alpha?label=npm%40alpha)](https://www.npmjs.com/package/cueloop)
[![ci](https://github.com/mmurakaru/cueloop/actions/workflows/ci.yml/badge.svg)](https://github.com/mmurakaru/cueloop/actions/workflows/ci.yml)
[![license](https://img.shields.io/badge/license-Apache--2.0-blue)](./LICENSE)

A terminal-first review surface for coding agents. The product is the
primitive: a **ReviewSession** anyone can render, annotate, and extend.

One loop: an agent submits an artifact and blocks · you annotate and return a
verdict · annotations serialize into structured feedback the agent acts on.

```
agent → daemon → your terminal → verdict → agent
```

## The trio

- **plan** - an agent (Claude Code and pi today; Codex planned) submits its plan
  and blocks on your verdict through a hook.
- **diff** - `cueloop diff` reviews your working tree, untracked files included.
- **review** - pull-request review (coming: `cueloop review <pr>`).

## Install

```bash
npm i -g cueloop@alpha      # the CLI
cueloop --help
```

Alpha: expect rough edges and breaking changes between versions. Releases are
published under the `alpha` dist-tag - see [releases](https://github.com/mmurakaru/cueloop/releases)
and [packages/cli/CHANGELOG.md](./packages/cli/CHANGELOG.md).

## Develop

```bash
bun install
bun test ./packages ./test            # the whole pyramid
bun run examples/1-hello-plan/run.ts  # seeded plan session in the TUI
```

As a Claude Code plugin (the plan-gate hook plus `/cueloop:plan`, `/cueloop:diff`, `/cueloop:review`):

```
/plugin marketplace add mmurakaru/cueloop
/plugin install cueloop@cueloop
```

Or wire the hook by hand (blocks the plan gate on your review):

```jsonc
// ~/.claude/settings.json
{
  "hooks": {
    "PermissionRequest": [{
      "matcher": "ExitPlanMode",
      "hooks": [{ "type": "command", "command": "bun run <repo>/packages/adapters/claude-code/hook.ts", "timeout": 600 }]
    }]
  }
}
```

## Grammar

`j/k` move · `v` span - shows the marker toolbar (`comment · cut · actions`;
`l/h` grow/shrink, `w/b` slide, `$` end) · `c` comment · `a` quick-actions (a
preset-comment list) · `x` cut (serializes into the one plan.md diff) · `e` edit
the whole file in `$EDITOR` · `n/p` annotations · `⏎` submit (verdict ←/→) ·
`q` quit. Every action is rebindable in `~/.config/cueloop/config.toml`
(`[keys]`); the quick-actions list is `[[actions]]`. Pick a built-in theme in
Settings or with `[ui] theme` (`cueloop`,
`rose-pine-moon`, `catppuccin-mocha`, `tokyo-night`, `gruvbox-dark`, `nord`);
individual tokens override under `[theme]`.

## Architecture

```
packages/
  schema/         ReviewSession, block model, quote-primary anchors, feedback.md
  daemon/         unix-socket daemon: atomic store, resumable waits, events
  client/         the TUI (OpenTUI React): projection renderer, grammar, rail
  extension-api/  the typed exporter contract for integrations
  adapters/       claude-code hook and pi extension (codex planned)
  cli/            cueloop · cueloop diff · cueloop session * (the script surface)
```

The daemon is the only stateful part; every client is a thin renderer over one
0600 unix socket. Verdicts outlive waits: an agent-side timeout never loses a
review. See `AGENTS.md` for dev-loop conventions and the test pyramid.

## Packages

| package | what it is |
| --- | --- |
| [`cueloop`](https://www.npmjs.com/package/cueloop) | the CLI and TUI |
| [`@cueloop/schema`](https://www.npmjs.com/package/@cueloop/schema) | the ReviewSession primitive, anchors, feedback serialization |
| [`@cueloop/daemon`](https://www.npmjs.com/package/@cueloop/daemon) | the session daemon and its client |
| [`@cueloop/client`](https://www.npmjs.com/package/@cueloop/client) | the review UI |
| [`@cueloop/extension-api`](https://www.npmjs.com/package/@cueloop/extension-api) | the typed extension contract |
| [`@cueloop/adapters`](https://www.npmjs.com/package/@cueloop/adapters) | Claude Code and pi adapters (Codex planned) |
| [`@cueloop/integration-obsidian`](https://www.npmjs.com/package/@cueloop/integration-obsidian) | the Obsidian vault export integration |
| [`@cueloop/gateway`](./packages/gateway) | the SSH sharing gateway (internal, not published) |

Apache-2.0. Contributions: every PR ships a changeset (`bunx changeset`) - see
[AGENTS.md](./AGENTS.md). The design
decisions behind cueloop are recorded in the
[closed decision tickets](https://github.com/mmurakaru/cueloop/issues?q=is%3Aissue+is%3Aclosed+label%3Awayfinder%3Agrilling).
