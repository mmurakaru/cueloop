<p align="center">
  <a href="https://cueloop.dev">
    <svg width="20" height="20" viewBox="0 0 32 32" class="wordmark__logo" aria-hidden="true" xmlns="http://www.w3.org/2000/svg"> <mask id="clm-hdr"> <rect width="32" height="32" fill="#fff"></rect> <path d="M 24.10 16.17 C 23.38 18.90, 20.52 22.17, 18.04 23.20 C 15.56 24.22, 11.78 23.54, 9.23 22.32 C 6.68 21.11, 3.33 18.42, 2.76 15.90 C 2.18 13.37, 3.94 9.22, 5.78 7.16 C 7.61 5.10, 10.99 3.59, 13.76 3.53 C 16.53 3.47, 20.66 4.71, 22.39 6.81 C 24.11 8.92, 24.83 13.44, 24.10 16.17 Z" fill="#000"></path> </mask> <mask id="cli-hdr"> <rect width="32" height="32" fill="#fff"></rect> <path d="M 16.04 16.62 C 14.71 17.74, 11.83 17.66, 9.94 17.31 C 8.04 16.96, 5.60 16.03, 4.66 14.52 C 3.71 13.01, 3.53 9.84, 4.29 8.23 C 5.05 6.62, 7.38 5.42, 9.22 4.85 C 11.06 4.29, 13.91 3.88, 15.35 4.84 C 16.80 5.80, 17.75 8.64, 17.87 10.60 C 17.98 12.57, 17.36 15.50, 16.04 16.62 Z" fill="#000"></path> </mask> <circle cx="16" cy="16" r="12" fill="#9a9ca6" mask="url(#clm-hdr)"></circle> <path d="M 22.69 15.82 C 22.06 18.19, 19.59 21.02, 17.44 21.91 C 15.30 22.79, 12.02 22.20, 9.82 21.15 C 7.61 20.10, 4.72 17.78, 4.22 15.59 C 3.72 13.40, 5.24 9.81, 6.83 8.03 C 8.42 6.24, 11.34 4.93, 13.74 4.88 C 16.13 4.83, 19.71 5.90, 21.20 7.73 C 22.70 9.55, 23.31 13.46, 22.69 15.82 Z" fill="#6b6d76" mask="url(#cli-hdr)"></path> <path d="M 15.03 15.49 C 13.97 16.39, 11.67 16.33, 10.15 16.05 C 8.63 15.77, 6.68 15.03, 5.92 13.82 C 5.17 12.60, 5.02 10.07, 5.63 8.79 C 6.24 7.50, 8.10 6.53, 9.58 6.08 C 11.05 5.63, 13.33 5.31, 14.48 6.07 C 15.64 6.84, 16.40 9.11, 16.49 10.68 C 16.59 12.25, 16.09 14.60, 15.03 15.49 Z" fill="#2f3037"></path> </svg>
  </a>
</p>
<p align="center">
  <a href="https://www.npmjs.com/package/cueloop"><img alt="npm" src="https://img.shields.io/npm/v/cueloop/alpha?label=npm%40alpha&style=flat-square" /></a>
  <a href="./LICENSE"><img alt="license" src="https://img.shields.io/badge/license-Apache--2.0-blue?style=flat-square" /></a>
</p>

# cueloop

A terminal-first self-extensible review surface for coding agents.  

One loop: an agent submits an artifact, you annotate and return a
verdict - annotations serialize into structured feedback the agent acts on.

```
agent > daemon > your terminal > verdict > agent
```

## The primitives

- **plan**
- **diff**
- **review**
- **prototype** (coming soon)

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
