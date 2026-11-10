import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { DaemonServer } from "@cueloop/daemon";
import { DaemonClient } from "@cueloop/daemon/client";
import type { AgentHarnessAdapter } from "@cueloop/schema";
import {
  advanceSyncExecution,
  SyncExecutionClaimSchema,
  type SyncExecutionReport,
} from "@cueloop/sync/execution";
import * as v from "valibot";
import { createCueloopSyncExecutor } from "./sync-executor";

test("owner execution recovers a lost daemon acknowledgement and restart without dispatching twice", async () => {
  const home = mkdtempSync(join(tmpdir(), "cueloop-sync-executor-"));
  let calls = 0;
  const adapter: AgentHarnessAdapter = {
    id: "sync-owner-test",
    label: "Sync owner test",
    connect: ({ onEvent }) => ({
      start: async () => "owner-session",
      prompt: async () => {
        calls++;
        onEvent({ kind: "message", id: "answer", text: "Owner answer" });

        return { outcome: "completed" as const };
      },
      cancel() {},
      permission() {},
      close() {},
    }),
  };
  let server = new DaemonServer({ home, idleExitMs: 0, threadAgent: { enabled: true, adapter } });

  server.start();
  const thread = server.core.sessionCreate({
    workspace: { repoRoot: home, branch: "main" },
    artifact: { type: "plan", content: "Owner plan", meta: {} },
  });
  let client = await DaemonClient.connect({ home });
  const claim = v.parse(SyncExecutionClaimSchema, {
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
  const binding = {
    workspaceIdentifier: claim.workspaceIdentifier,
    targetIdentifier: claim.targetIdentifier,
    threadIdentifier: thread.id,
  };
  const reports: SyncExecutionReport[] = [];
  const queue = {
    claim: async () => claim,
    report: async (report: SyncExecutionReport) => {
      reports.push(report);
    },
  };

  try {
    const executor = createCueloopSyncExecutor({
      identifier: claim.executorIdentifier,
      bindings: [binding],
      client: {
        agentGet: (identifier, options) => client.agentGet(identifier, options),
        agentPrompt: async (input, options) => {
          await client.agentPrompt(input, options);
          throw new Error("Owner acknowledgement lost after daemon acceptance");
        },
      },
    });

    await advanceSyncExecution({ queue, executor });
    const deadline = Date.now() + 5000;

    while (reports.at(-1)?.observation.status !== "completed" && Date.now() < deadline) {
      await advanceSyncExecution({ queue, executor });

      if (reports.at(-1)?.observation.status !== "completed") await Bun.sleep(5);
    }

    expect(reports.at(-1)?.observation.status).toBe("completed");
    expect(calls).toBe(1);
    expect((await client.sessionGet(thread.id)).status).toBe("pending");
    client.close();
    server.stop();
    server = new DaemonServer({ home, idleExitMs: 0, threadAgent: { enabled: true, adapter } });
    server.start();
    client = await DaemonClient.connect({ home });
    const restarted = createCueloopSyncExecutor({
      identifier: claim.executorIdentifier,
      bindings: [binding],
      client,
    });

    await advanceSyncExecution({ queue, executor: restarted });
    expect(reports.at(-1)?.observation.status).toBe("completed");
    expect(calls).toBe(1);
    expect((await client.agentGet(thread.id)).promptOperations).toHaveLength(1);
    const rejected = await restarted.recover({ ...claim, action: "session.sendMessage" });

    expect(rejected.status).toBe("recovery-required");
    expect((await client.sessionGet(thread.id)).status).toBe("pending");
    expect(await restarted.recover({ ...claim, input: { text: "Changed input" } })).toMatchObject({
      status: "failed",
    });
    expect(calls).toBe(1);
  } finally {
    client.close();
    server.stop();
    rmSync(home, { recursive: true, force: true });
  }
});
