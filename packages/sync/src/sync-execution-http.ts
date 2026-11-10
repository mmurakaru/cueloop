import * as v from "valibot";
import {
  SyncExecutionClaimSchema,
  SyncExecutionRequestSchema,
  type SyncExecutionQueue,
} from "./sync-execution.ts";

/** Authentication belongs to the application; cancellation stops observation, not provider work. */
export function createSyncExecutionQueue(options: {
  url: string;
  workspaceIdentifier: string;
  headers: () => HeadersInit | Promise<HeadersInit>;
  fetch?: typeof globalThis.fetch;
}): SyncExecutionQueue {
  const endpoint = new URL(options.url);
  const workspaceIdentifier = v.parse(
    v.pipe(v.string(), v.uuid(), v.toLowerCase()),
    options.workspaceIdentifier,
  );

  if (!["http:", "https:"].includes(endpoint.protocol) || endpoint.username || endpoint.password)
    throw new Error("Sync execution endpoint requires an HTTP or HTTPS URL without credentials");

  const request = async (
    input: v.InferOutput<typeof SyncExecutionRequestSchema>,
    signal?: AbortSignal,
  ) => {
    const headers = new Headers(await options.headers());

    headers.set("content-type", "application/json");
    const response = await (options.fetch ?? globalThis.fetch)(endpoint, {
      method: "POST",
      headers,
      body: JSON.stringify(v.parse(SyncExecutionRequestSchema, input)),
      signal: signal
        ? AbortSignal.any([signal, AbortSignal.timeout(30000)])
        : AbortSignal.timeout(30000),
      redirect: "error",
    });

    if (!response.ok) throw new Error(`Sync execution request failed with HTTP ${response.status}`);

    return response;
  };

  return {
    async claim({ executorIdentifier, signal }) {
      const response = await request(
        { action: "claim", workspaceIdentifier, executorIdentifier },
        signal,
      );
      const result = v.parse(
        v.strictObject({ claim: v.nullable(SyncExecutionClaimSchema) }),
        await response.json(),
      );

      if (result.claim && result.claim.workspaceIdentifier !== workspaceIdentifier)
        throw new Error("Sync execution response belongs to a different workspace");

      return result.claim;
    },
    async report(report, signal) {
      await request({ action: "report", ...report }, signal);
    },
  };
}
