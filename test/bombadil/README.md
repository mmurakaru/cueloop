# Bombadil terminal tests

Explore cueloop's real TUI with generated navigation, mouse clicks, terminal resizes, and Unicode comment drafts.
Bombadil 0.7.10 runs the application in a pseudo-terminal and checks properties against rendered terminal states.

## Run

Requires Bun 1.4.4 or later and macOS ARM64, Linux x64, or Linux ARM64.
Run from the repository root:

```sh
bun install --frozen-lockfile
bun run test:bombadil
```

Each ordinary campaign runs for 30 seconds.
A negative control checks that the suite detects a deliberately invalid fixture.
Choose a campaign, duration in seconds, or empty output directory:

```sh
bun run test:bombadil --scenario plan --duration 60 --output tmp/bombadil-plan
bun run test:bombadil --scenario diff
bun run test:bombadil --scenario draft
bun run test:bombadil --scenario negative-control
```

## Properties

- A review becomes usable after the application's ready-file signal.
- Navigation and resize recover a usable review within two seconds.
- A usable plan contains a fixture paragraph; a usable diff contains a fixture code row.
- The application remains running throughout exploration.
- Well-formed fixtures and typed Unicode do not render replacement characters.
- A typed Unicode draft becomes visible within one second.
- Generated navigation and draft cancellation leave saved review data unchanged.

The runner uses isolated daemon homes, synthetic review content, and temporary Git repositories.
It disables terminal integrations and places a failing SSH command first on the child's PATH.
Actions wait for a fixture revision published after the real ready-file signal.

> [!IMPORTANT]
> The negative control inserts a replacement character into the fixture after readiness.
> It passes only when Bombadil exits with the expected `noReplacementChars` violation.
> Ordinary campaigns must have no violations and must exercise at least ten actions.
> Each must resize the terminal, navigation must click fixture text, and draft exploration must type Unicode.

## Evidence

The runner prints its report directory.
Each campaign saves `report.json`, `bombadil.log`, and `trace/trace.jsonl.gz`.
The suite saves `summary.json` and `summary.md`, with observed states, actions, terminal sizes, and persisted-data checks.
Reports include the compressed trace's SHA-256 hash.
Existing nonempty output directories are preserved.

GitHub Actions uploads `bombadil-terminal-evidence` and adds the results to the job summary.
The workflow runs on pull requests that change the application or test setup and can be dispatched manually.

## Replay

Replay a recorded trace against a fresh instance of the same fixture:

```sh
bun run test:bombadil --scenario plan --reproduce tmp/bombadil-plan/plan/trace/trace.jsonl.gz
```

> [!NOTE]
> Bombadil terminal reproduction is best-effort.
> Different timing can change which actions are available and produce a divergence error.
> Keep the original specification, tool versions, report, and trace when investigating a violation.

The [upstream terminal driver](https://github.com/antithesishq/bombadil/tree/v0.7.10/lib/bombadil-terminal) defines the rendered-state and action contracts.
