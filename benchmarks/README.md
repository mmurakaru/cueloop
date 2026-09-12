# Benchmarks

Numbers for the things a user feels: how fast the binary starts, how long the
TUI takes to paint, what a key press costs, how the daemon answers, and how
much memory a review holds.

## Run

```bash
bun run bench                                     # the default suite, 3 samples each
bun run bench -- --samples 5 --out benchmarks/results/local.json
bun run bench -- --script artifact-parse --script daemon-roundtrip
CUELOOP_TEST_EXECUTABLE=packages/cli/dist/cueloop bun run bench   # startup and first frame of the compiled binary
```

`benchmarks/results/` is gitignored.

## How it works

Every script under `benchmarks/` is a plain bun program that prints one
`METRIC name=value` line per measurement to stdout. The sampler (`run.ts`) runs
each script as a fresh process N times, so every sample is a cold JIT and heap,
then folds the samples into median and p95 per metric and writes the JSON a
release gate can compare.

The metric name decides its unit and whether a gate compares it, so scripts
stay dumb:

| suffix or prefix | unit    | gated |
| ---------------- | ------- | ----- |
| `*_ms`           | ms      | yes   |
| `*_heap`         | bytes   | yes   |
| `is_*`           | boolean | no    |
| `*_bytes`        | bytes   | no    |
| anything else    | count   | no    |

The thresholds a gate applies live with the gate, not in the result rows. The
gate's absolute floor for timings is 5 ms: a gated timing whose median sits
below it can never fail, so the table flags it as `below floor` and the script
should batch its work (`timeBatchMs`) until the total clears it. Two timings
stay below the floor on purpose because they cannot be batched: daemon start
to listen and client connect. Treat them as context.

Memory: `emitMemoryMetrics` runs a full collection first, then reports heap in
use (`*_heap`, gated, the retained ceiling) and resident set size
(`*_rss_bytes`, context only: a process high-water mark that includes the
runtime and never shrinks).

Two-level p95: an interaction script computes p95 within one process across
its presses and emits it as its own metric; the sampler then takes the median
of that p95 across processes. That separates one slow press from one slow
process. With three or seven cold samples the sampler's own `p95` column is
the maximum, so a gate should compare `median`, including the median of a
`*_p95_ms` row, and treat the `p95` column as context until n is 20 or more.

Press latency is timed until the painted frame settles, and settling costs
about 14 ms of harness on its own. The numbers compare between runs; they are
not what a user feels in absolute terms.

Two first-frame numbers exist on purpose. `render_ready_ms` in the in-process
scripts is the cost of rendering the artifact with the daemon already up.
`plan_ready_*_ms` in `tui-first-frame` is the launch a user feels: process
start, module load, daemon connect, and paint, in a real pseudo terminal.

## Scripts

| script                | measures                                                                   |
| --------------------- | -------------------------------------------------------------------------- |
| `binary-startup`      | `--version` cold and warm, `--help`; needs the executable env, else none   |
| `artifact-parse`      | plan parse, anchor resolution on the exact and fuzzy tier, diff rows       |
| `daemon-roundtrip`    | daemon start to listen, client connect, session create and get p95         |
| `tui-first-frame`     | spawn to ready signal in a real pseudo terminal, cold and warm             |
| `interaction-latency` | render to ready, then eight caret moves down a large plan, median and p95  |
| `large-stream`        | render to ready of a 180-file diff and caret steps through it, plus memory |
| `non-ascii-stream`    | the same on wide characters and emoji                                      |

## Add a metric

Print `METRIC <name>=<number>` from a script through `emitMetric`, following
the suffix table. Add a new script to `DEFAULT_SCRIPTS` in `run.ts`. Counts
that describe the fixture (`files`, `patch_bytes`) are welcome: they make a
result file self-explaining.

## Release gate

`scripts/benchmarks/gate.ts` runs in the release workflow between the build
and the draft release, once per target on the target's own runner. It resolves
the previous published release (the newest `cueloop@` tag below the head
version, `scripts/benchmarks/previous-release.ts`), downloads that binary, and
measures base and head interleaved with the binary-sensitive scripts, the
order alternating per sample so neither side always follows the other's warm
caches. Startup gets 15 cold samples per side, the first frame 5. A failing
comparison is confirmed by a second independent pass before it counts.

The runs are compared with `scripts/benchmarks/compare.ts`:

- rows compare on the sampler median, including the median of `*_p95_ms`
  rows, for the reason given above;
- a gated row fails only when both bounds are exceeded: timings +15 percent
  and +5 ms, memory +20 percent and +8 MiB;
- a gated timing under the 5 ms floor on both sides is `below-floor`, a new
  metric is `missing-base` and informational, a gated metric that vanished is
  `missing-head` and fails, so nobody deletes a gated metric silently;
- `benchmarks/accepted-regressions.json` lists reviewed regressions as
  `{ name, untilVersion, reason }`; a match turns a fail into `accepted`
  until the head version reaches `untilVersion`;
- `benchmarks/metric-aliases.json` maps an old metric name to its new one so
  a rename stays comparable.

A base binary that cannot run today's fixtures (an old release against a new
daemon) is not a regression of the head: the gate then reports every row as
`missing-base`, says so in the summary, and passes. The first release that
carries the ready signal (0.1.0-alpha.69) compares startup only, because the
older base cannot report a first frame; the gate tells the first-frame script
which side supports the signal through `CUELOOP_BENCH_READY_SIGNAL`.

The gate writes a Markdown table to the job summary and a JSON record per
target (both runs, the comparison, and any accepted reason). The finalize job
attaches those records to the GitHub release before it flips live, so the
history lives with the release it describes.

A release operator can publish over a regression by running the workflow by
hand with `allow_benchmark_regression` set and a non-empty
`benchmark_regression_reason`; the guard job rejects the run in seconds when
the reason is missing, and the reason lands in the summary and the record.
Pushes to main cannot bypass the gate.

The native shims ship for darwin-arm64 only, so the pseudo-terminal first
frame is measured on that target and the other three compare binary startup.
