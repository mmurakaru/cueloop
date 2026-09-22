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

A terminal-first multiplayer thread for agent-authored work.

## The primitives

- **plan**
- **diff**
- **review**
- **prototype** (experimental)

## Install

```bash
curl -fsSL https://cueloop.dev/install.sh | sh
cueloop --help
```

[releases](https://github.com/mmurakaru/cueloop/releases) - [changelog](./packages/cli/CHANGELOG.md)

Claude Code integration requires Claude Code 2.1.278 or newer with Mods enabled. Start it with `CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1 claude`.

## Harness installation

### Claude Code

```bash
claude plugin marketplace add mmurakaru/cueloop && claude plugin install cueloop@cueloop
```

### Codex

```bash
codex plugin marketplace add mmurakaru/cueloop && codex plugin add cueloop@cueloop
```

### pi

```bash
pi install npm:@cueloop/pi
```

## Packages

| package                                                                                        | description                                           |
| ---------------------------------------------------------------------------------------------- | ----------------------------------------------------- |
| [`cueloop`](https://www.npmjs.com/package/cueloop)                                             | the CLI and TUI                                       |
| [`@cueloop/schema`](https://www.npmjs.com/package/@cueloop/schema)                             | the Thread primitive, anchors, feedback serialization |
| [`@cueloop/daemon`](https://www.npmjs.com/package/@cueloop/daemon)                             | the session daemon and its client                     |
| [`@cueloop/client`](https://www.npmjs.com/package/@cueloop/client)                             | the review UI                                         |
| [`@cueloop/extension-api`](https://www.npmjs.com/package/@cueloop/extension-api)               | the typed extension contract                          |
| [`@cueloop/adapters`](https://www.npmjs.com/package/@cueloop/adapters)                         | Claude Code, pi and codex adapters                    |
| [`@cueloop/integration-obsidian`](https://www.npmjs.com/package/@cueloop/integration-obsidian) | the Obsidian vault export integration                 |
| [`@cueloop/gateway`](./packages/gateway)                                                       | the SSH sharing gateway                               |
