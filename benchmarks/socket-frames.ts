/** Large real-socket responses isolate framing cost from terminal rendering. */
import { DaemonClient } from "@cueloop/daemon/client";
import { createTestReviewHome } from "../test/helpers/review-home";
import { emitLatencyMetrics, emitMetric, timeRepeatedAsync } from "./lib/metric";

const review = createTestReviewHome();
const content = "A deterministic large review line.\n".repeat(120_000);
const thread = review.createPlanSession(content);
const client = await DaemonClient.connect({ home: review.home });

try {
  const read = async () => {
    const result = await client.sessionGet(thread.id);

    if (result.artifact.content !== content) throw new Error("Socket benchmark content mismatch");
  };

  await read();
  emitMetric("artifact_bytes", Buffer.byteLength(content));
  emitLatencyMetrics("large_response", await timeRepeatedAsync(30, read));
} finally {
  client.close();
  review.cleanup();
}
