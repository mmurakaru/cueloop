import { expect, test } from "bun:test";
import * as v from "valibot";
import {
  advanceSyncExecution,
  SyncExecutionClaimSchema,
  type SyncExecutionObservation,
  type SyncExecutionReport,
} from "./sync-execution.ts";

const CLAIM = v.parse(SyncExecutionClaimSchema, {
  operationIdentifier: "019a6819-bf85-7000-8000-000000000001",
  workspaceIdentifier: "019a6819-bf85-7000-8000-000000000002",
  targetIdentifier: "019a6819-bf85-7000-8000-000000000003",
  requesterIdentifier: "collaborator",
  action: "agent.prompt",
  input: { text: "Explain the plan" },
  executorIdentifier: "019a6819-bf85-7000-8000-000000000004",
  leaseIdentifier: "019a6819-bf85-7000-8000-000000000005",
  fencingToken: 1,
});

test("an uncertain execution acknowledgement recovers provider state before another dispatch", async () => {
  let dispatches = 0;
  let providerState: SyncExecutionObservation = { status: "absent" };
  const reports: SyncExecutionReport[] = [];
  const executor = {
    identifier: CLAIM.executorIdentifier,
    recover: async () => providerState,
    dispatch: async () => {
      dispatches++;
      providerState = { status: "completed", reference: "local-prompt-1" };
      throw new Error("Execution acknowledgement was lost");
    },
  };
  const queue = {
    claim: async () => CLAIM,
    report: async (report: SyncExecutionReport) => {
      reports.push(report);
    },
  };

  await advanceSyncExecution({ executor, queue });
  await advanceSyncExecution({ executor, queue });
  expect(dispatches).toBe(1);
  expect(reports.map((report) => report.observation)).toEqual([
    { status: "completed", reference: "local-prompt-1" },
    { status: "completed", reference: "local-prompt-1" },
  ]);
});

test("unavailable recovery pauses an accepted intent without dispatch or private error disclosure", async () => {
  let dispatches = 0;
  const reports: SyncExecutionReport[] = [];
  const queue = {
    claim: async () => CLAIM,
    report: async (report: SyncExecutionReport) => {
      reports.push(report);
    },
  };

  await advanceSyncExecution({
    queue,
    executor: {
      identifier: CLAIM.executorIdentifier,
      recover: async () => {
        throw new Error("private-provider-credential");
      },
      dispatch: async () => {
        dispatches++;

        return { status: "completed" };
      },
    },
  });
  expect(dispatches).toBe(0);
  expect(reports[0]?.observation).toEqual({
    status: "recovery-required",
    message: "Execution integration recovery is unavailable",
  });
  expect(JSON.stringify(reports)).not.toContain("private-provider-credential");
});

test("cancellation after absence recovery cannot start external work", async () => {
  const cancellation = new AbortController();
  let dispatches = 0;
  let reports = 0;

  await expect(
    advanceSyncExecution({
      signal: cancellation.signal,
      queue: {
        claim: async () => CLAIM,
        report: async () => {
          reports++;
        },
      },
      executor: {
        identifier: CLAIM.executorIdentifier,
        recover: async () => {
          cancellation.abort();

          return { status: "absent" };
        },
        dispatch: async () => {
          dispatches++;

          return { status: "completed" };
        },
      },
    }),
  ).rejects.toThrow();
  expect(dispatches).toBe(0);
  expect(reports).toBe(0);
});
