# Performance experiments

- Generate deterministic fixtures before timing. Keep inputs, terminal dimensions, runtime and flags identical on both sides.
- Separate cold startup, first correct paint, settled paint and warm interaction. Do not call a breadcrumb a completed content paint.
- Run benchmarks sequentially. Do not run tests, builds or other profilers during a timing comparison.
- Change one product behavior at a time. Record the hypothesis, declared metric, raw process pairs, confidence interval and keep/revert decision.
- Use paired-experiment.ts for alternating baseline/candidate source comparisons. Only list the product files belonging to that experiment. Both sides use the same benchmark and preload machinery.
- The baseline loader replaces source text from the specified Git revision before imports. Never replace a dependency, fixture or benchmark differently between sides.
- Establish unchanged-code noise first. Profile separately from timing runs. Never use profiler timings as acceptance results.
- A retained change needs at least 5 percent improvement in its declared metric and a paired 95 percent bootstrap interval below a ratio of one. Report end-to-end effects separately.
- The overall target is at least 30 percent lower p95 in diff navigation, Thread switching, scrolling and typing during agent streaming. Do not weaken the target when experiments fail.
- Correctness is a hard gate: output content, selection, anchors, Unicode, resize, cancellation, reconnect and lifecycle behavior must stay correct. No observed regression is not proof that regressions are impossible.
- Use pre-generated input, setup outside timing, isolated stages, no-op controls, representative execution, repeated comparisons and end-to-end validation. Do not add a second benchmark framework.
