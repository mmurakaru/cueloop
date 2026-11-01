/** End-to-end draft paint during deterministic agent updates with a populated inbox. */
import { runTestAgentStreamReview } from "../test/helpers/agent-stream-review";
import { HERMETIC_TERMINAL_ENV } from "../test/helpers/env";
import { emitLatencyMetrics, emitMetric } from "./lib/metric";

Object.assign(process.env, HERMETIC_TERMINAL_ENV);
const result = await runTestAgentStreamReview();

if (!result.draftPreserved || !result.streamPreserved)
  throw new Error("Agent stream benchmark lost the draft or final answer");

emitLatencyMetrics("stream_draft_paint", result.samples);
emitMetric("stream_inbox_reads", result.listReads);
emitMetric("stream_thread_reads", result.threadReads);
process.exit(0);
