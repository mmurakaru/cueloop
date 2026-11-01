/** Draft paint during a long answer exercises conversation projection through the complete App. */
import { runTestAgentStreamReview } from "../test/helpers/agent-stream-review";
import { HERMETIC_TERMINAL_ENV } from "../test/helpers/env";
import { emitLatencyMetrics, emitMetric } from "./lib/metric";

Object.assign(process.env, HERMETIC_TERMINAL_ENV);
const result = await runTestAgentStreamReview({ paragraphs: 300 });

if (!result.draftPreserved || !result.streamPreserved)
  throw new Error("Long agent stream benchmark lost the draft or final answer");

emitLatencyMetrics("long_stream_draft_paint", result.samples);
emitMetric("answer_sections", 300);
emitMetric("stream_inbox_reads", result.listReads);
process.exit(0);
