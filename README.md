# cueloop

A terminal-first review surface for coding agents. The product is the
primitive: a **ReviewSession** anyone can render, annotate, and extend.

One loop: an agent submits an artifact and blocks · you annotate and return a
verdict · annotations serialize into structured feedback the agent acts on.

```
agent → daemon → your terminal → verdict → agent
```

## The trio

- **plan** - an agent (Claude Code today; Codex and pi next) submits its plan
  and blocks on your verdict through a hook.
- **diff** - `cueloop diff` reviews your working tree, untracked files included.
- **review** - pull-request review (coming: `cueloop review <pr>`).

## Install

```bash
npm i -g cueloop@alpha      # the CLI
cueloop --help
```

Alpha: expect rough edges and breaking changes between versions.

## Develop

```bash
bun install
bun test ./packages ./test            # the whole pyramid
bun run examples/1-hello-plan/run.ts  # seeded plan session in the TUI
```

Wire the Claude Code hook (blocks the plan gate on your review):

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

`j/k` move · `v` span (`l/h` grow/shrink, `w/b` slide, `$` end) · `c` comment ·
`s` suggest · `x` cut (serializes into the one plan.md diff) · `e` edit the
whole file in `$EDITOR` · `n/p` annotations · `⏎` submit (verdict ←/→) ·
`q` quit. Every action is rebindable in `~/.config/cueloop/config.toml`
(`[keys]`), theme tokens override under `[theme]`.

## Architecture

```
packages/
  schema/         ReviewSession, block model, quote-primary anchors, feedback.md
  daemon/         unix-socket daemon: atomic store, resumable waits, events
  client/         the TUI (OpenTUI React): projection renderer, grammar, rail
  extension-api/  typed ExtensionAPI + zero-build TS loader with repo trust
  adapters/       claude-code hook (codex, pi next)
  cli/            cueloop · cueloop diff · cueloop session * (the script surface)
```

The daemon is the only stateful part; every client is a thin renderer over one
0600 unix socket. Verdicts outlive waits: an agent-side timeout never loses a
review. See `AGENTS.md` for dev-loop conventions and the test pyramid.

Apache-2.0. Decisions live in the [map issue](https://github.com/mmurakaru/cueloop/issues/1).
