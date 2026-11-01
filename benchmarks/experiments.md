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
| Ignore transcript events in the review controller | Streaming draft paint p95        | 10.90 ms  | 6.41 ms   | 20 pairs; ratio interval 0.5646-0.7001 | Retain; 41.2 percent improvement |
| Renderer target 60 FPS                            | Calibrated diff scroll paint p95 | 17.30 ms  | 20.60 ms  | 5 pairs; ratio interval 0.9179-1.2555  | Revert; no measurable gain       |
| Skip anchor projection for uncommented messages   | Long-answer draft paint p95      | 14.60 ms  | 13.62 ms  | 20 pairs; ratio interval 0.8428-1.0244 | Revert; no reliable p95 gain     |

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
test but regress p95 by 25.5 percent, so that trial was reverted. A conditional
commit resolves only pending caret state before the next arrow. In 11 pairs,
all candidate bursts preserve every step; baseline bursts lose 8-15 steps.
Its latency interval crosses one, so this is a correctness repair, not a
claimed latency improvement. Ref-only and row-geometry trials were rejected. Timing uses
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
