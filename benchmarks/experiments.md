# TUI performance experiments - 2026-11-01

Original source: `566053c3`. Runtime: Bun 1.3.14, macOS arm64.
Tracking: #609 (measurement), #610 (streaming), #611 (framing), #612 (scrolling),
#613 (conversation projection), #614 (complete verification).

The goal is at least 30 percent lower p95 in each primary workflow: diff
navigation, Thread switching, scrolling, and typing during agent streaming.
A retained optimization needs at least 5 percent improvement in its declared
metric with a paired 95 percent interval excluding no improvement. No observed
behavior or visual regression is allowed. These experiments do not prove that
all regressions are impossible.

## Protocol

Use the existing fixtures and sampler. Generate fixtures before timing, fix
terminal dimensions and runtime, and run baseline and candidate sequentially
with alternating order. Freeze only the product source files belonging to one
experiment. Both sides use the same benchmark code and observer. Run profiles
separately. Save raw process pairs and the exact source diff in the result JSON.
Treat each process as the sampling unit, not each key press. Confidence
intervals are deterministic paired bootstrap intervals for median process
results. A p95 row contains each process's within-run p95.

## Experiments completed before final verification

| Change                                            | Declared metric                  | Baseline  | Candidate | Evidence                               | Decision                         |
| ------------------------------------------------- | -------------------------------- | --------- | --------- | -------------------------------------- | -------------------------------- |
| Chunked socket frame accumulation                 | Large real-socket response p95   | 494.71 ms | 50.52 ms  | 11 pairs; ratio interval 0.0987-0.1043 | Retain; 89.8 percent improvement |
| Ignore transcript events in the review controller | Streaming draft paint p95        | 9.55 ms   | 6.38 ms   | 20 pairs; ratio interval 0.5701-0.7489 | Retain; 33.1 percent improvement |
| Renderer target 60 FPS                            | Calibrated diff scroll paint p95 | 17.30 ms  | 20.60 ms  | 5 pairs; ratio interval 0.9179-1.2555  | Revert; no measurable gain       |
| Skip anchor projection for uncommented messages   | Long-answer draft paint p95      | 14.11 ms  | 13.59 ms  | 20 pairs; ratio interval 0.8638-1.0201 | Revert; no reliable p95 gain     |

The framing experiment did not establish a navigation or Thread-switch gain.
Its strongest result is the complete, content-checked, large socket response.
Do not add that improvement to the navigation result.

Unchanged-source controls showed substantial tail variation: the initial
Thread-switch p95 ratio interval reached 1.115, and the streaming p95 interval
was 0.722-1.114. Point estimates alone are not acceptance evidence. A few cold
processes cannot establish a precise tail distribution.

## Observer correction

The old PTY observer can sleep for 100 ms. Earlier approximately 64 ms scroll
paint results included this backoff. Test PTYs now cap read polling at 1 ms;
product PTYs retain their existing idle backoff. With the calibrated observer,
baseline diff scroll p95 was approximately 17-21 ms. This is a measurement
correction, not a TUI performance improvement. Both sides of source and binary
comparisons use the corrected observer.

The real-terminal burst check also exposed dropped caret steps: 70 arrows at
5 ms spacing reached row 62 in an unwrapped diff instead of row 70. A new PTY
regression test reproduces this. Unconditional synchronous commits pass the
test but regress p95 by 24.2 percent, so that trial was reverted. A conditional
commit resolves only pending caret state before the next arrow. In 11 pairs,
all candidate bursts preserve every step; baseline bursts lose 8-15 steps.
Its isolated latency interval crosses one. The final original-baseline
comparison found a 6.9 percent p95 cost (1.2 ms), with an interval above one.
The repair and its new regression test were removed from the first release;
the reproduction and trial patch remain recorded for the scroll follow-up. Ref-only and row-geometry trials were rejected. Timing uses
individual settled arrows, while burst correctness is checked separately, so
losing input cannot count as a faster result.

## Result artifacts

Local raw files are ignored under `benchmarks/results/`:

- `control-thread-switch.json`
- `control-agent-stream.json`
- `experiment-socket-fragments.json`
- `experiment-agent-events.json`
- `experiment-render-target.json`
- `experiment-conversation-marks.json`
- `experiment-caret-commit.json` (rejected synchronous commits)
- `experiment-pending-caret-commit.json` (correctness repair)
- `experiment-input-frame-cap.json` (rejected frame-cap trial)
- `calibrated-scroll-baseline.json`

Final verification results and remaining targets are recorded after the final
comparison. The 30 percent target has not yet been established in every workflow.

## First release scope

Only socket framing, agent-event filtering and benchmark instrumentation are
retained. Renderer target, input frame cap, conversation marks, identical Thread
revalidation and caret-commit trials were rejected. The caret reproduction
remains open under #612; the 30 percent navigation, Thread-switch and scrolling
targets are not achieved. Do not describe the first release as completing #614.

The original-baseline comparison measured streaming draft p95 11.03 -> 6.43 ms,
a 41.7 percent gain (ratio interval 0.5262-0.6087). Navigation and Thread-switch
changes were below the retained-improvement threshold. Scroll is rechecked
without the rejected caret repair before shipping.

The 20-pair scroll recheck without the caret trial measured median 10.69 ->
10.73 ms (ratio interval 0.9885-1.0671) and p95 16.99 -> 19.22 ms (interval
0.9922-1.2212). This does not establish an improvement or equivalence. It does
not confirm a slowdown at the selected interval; the scrolling target remains
open. No input or rendering change is included in the first release.

## Local shipping checks

After installing the same `jj` prerequisite as CI, the complete suite passed:
2,083 pass, 42 optional skips, zero failures, 122 snapshots. The complete PTY
tier passed all 37 tests with 546 assertions. Typecheck, lint, import boundaries
and formatting passed. Existing lint and type-cycle warnings remain.

## Review corrections

The paired tool now reuses the existing sampler's nearest-rank median for
point estimates and bootstrap resamples. Early local summaries used the upper
middle value for even counts. Raw samples were preserved; a separate
`shipping-summary.json` recalculates the accepted evidence under the existing
sampler convention. The keep/revert decisions do not change.

Process pairs are validated together against the warmup metric names before
collection. Missing metrics, invalid timings and incomplete requested counts
fail instead of producing misaligned paired samples. Lifecycle verification
opens the sidebar after the timed region and waits for the renamed and newly
created Threads to paint.
