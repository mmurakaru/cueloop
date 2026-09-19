/**
 * Report the drained perf marks for a scope two ways from one set of instrumentation: a phase block on
 * stderr when CUELOOP_PERF=1, and a kundi span tree when the OTLP endpoint is set. No-op when neither is on.
 */

import { formatPerfBlock, takePerfMarks } from "./perf-timings";
import { phaseMarksToSpans, postOtlpTrace } from "./otlp-trace";

const PERF_SERVICE_NAME = "cueloop-client";

export function reportPerfMarks(scope: string): void {
  const marks = takePerfMarks();
  if (marks.length === 0) return;

  if (process.env.CUELOOP_PERF === "1") process.stderr.write(formatPerfBlock(scope, marks));
  void postOtlpTrace(PERF_SERVICE_NAME, phaseMarksToSpans(scope, marks));
}
