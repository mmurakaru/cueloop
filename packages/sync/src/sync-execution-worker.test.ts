import { expect, test } from "bun:test";
import { SyncExecutionAuthorityError } from "./sync-execution.ts";
import { runSyncExecutionWorker } from "./sync-execution-worker.ts";

test("owner workers stop on revoked authority access without retrying or dispatching", async () => {
  let claims = 0;
  let dispatches = 0;
  const cancellation = new AbortController();

  await expect(
    runSyncExecutionWorker({
      signal: cancellation.signal,
      queue: {
        claim: async () => {
          claims++;
          throw new SyncExecutionAuthorityError(403);
        },
        report: async () => {
          throw new Error("A forbidden worker cannot report execution");
        },
      },
      executor: {
        identifier: "019a6819-bf85-7000-8000-000000000004",
        recover: async () => ({ status: "absent" }),
        dispatch: async () => {
          dispatches++;

          return { status: "completed" };
        },
      },
    }),
  ).rejects.toThrow("HTTP 403");
  expect(claims).toBe(1);
  expect(dispatches).toBe(0);
});
