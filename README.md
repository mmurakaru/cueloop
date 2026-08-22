<p align="center">
  <a href="https://cueloop.dev">
    <img src="assets/cueloop-logo.svg" width="128" height="128" alt="cueloop" />
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

Releases are published under the `alpha` dist-tag - see [releases](https://github.com/mmurakaru/cueloop/releases)
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
