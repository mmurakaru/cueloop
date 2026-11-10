import { expect, test } from "bun:test";
import { createSyncSqliteStorage } from "@cueloop/sync/storage";
import { submitSyncOperation } from "@cueloop/sync/operations";
import { createSyncExecutionQueue } from "@cueloop/sync/execution/http";
import { advanceSyncExecution, type SyncExecutionObservation } from "@cueloop/sync/execution";
import postgres from "postgres";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { createTestSyncStack } from "../helpers/sync-stack";
import { createSharedRecordClient } from "../../examples/sync-workspace/client.ts";
import { sharedRecordQueries } from "../../examples/sync-workspace/shared-record.ts";
import { sharedExecutionOperations } from "../../examples/sync-workspace/shared-execution.ts";
import {
  sharedWorkspaceMutators,
  sharedWorkspaceQueries,
} from "../../examples/sync-workspace/shared-workspace.ts";
import { lookupSharedOperationReceipt } from "../../examples/sync-workspace/operation-receipt-client.ts";
import { createSharedTextEditorSession } from "../../examples/sync-workspace/text-editor-client.ts";
import { waitForTestTextEditor } from "../helpers/sync-text-editor";

test.skipIf(process.env.CUELOOP_RUN_SYNC !== "1")(
  "accepted agent intent survives authority restart while collaborators edit without the owner",
  async () => {
    const stack = await createTestSyncStack({ collaborator: true });
    const reader = createSharedRecordClient(stack);
    const database = postgres(stack.environment.SYNC_DATABASE_URL);
    let collaborator: ReturnType<typeof createSharedRecordClient> | undefined;
    let editor: Awaited<ReturnType<typeof createSharedTextEditorSession>> | undefined;

    try {
      const [record] = await reader.run(sharedRecordQueries.records(), { type: "complete" });

      if (!record || !stack.collaborator)
        throw new Error("Sync execution test requires its record and collaborator");

      collaborator = createSharedRecordClient({ ...stack, ...stack.collaborator });
      await collaborator.run(sharedRecordQueries.records(), { type: "complete" });
      const operation = sharedExecutionOperations.request.create({
        authority: stack.authority,
        workspaceIdentifier: record.workspaceIdentifier,
        arguments: { recordIdentifier: record.id, text: "Explain this plan" },
      });
      const outcome = await submitSyncOperation({
        operation,
        submit: (request) =>
          collaborator!.mutate(sharedWorkspaceMutators.execution.request(request)),
        lookup: (request) =>
          lookupSharedOperationReceipt({ ...stack, ...stack.collaborator!, operation: request }),
      });

      expect(outcome.status).toBe("accepted");
      editor = await createSharedTextEditorSession({
        ...stack,
        ...stack.collaborator,
        workspaceIdentifier: record.workspaceIdentifier,
        recordIdentifier: record.id,
        storage: createSyncSqliteStorage({
          directory: join(stack.directory, "owner-offline-editor"),
        }),
      });
      await waitForTestTextEditor(
        editor,
        (snapshot) => snapshot.connection === "connected",
        "the collaborator editing without an owner executor",
      );
      editor.change("Plan edited while the owner is offline");
      expect((await editor.save()).status).toBe("accepted");
      await stack.restartAuthority();
      const recovered = createSharedRecordClient({
        ...stack,
        ...stack.collaborator,
        storageKey: `${stack.storageKey}-execution-recovered`,
      });

      try {
        const requests = await recovered.run(
          sharedWorkspaceQueries.executionRequests({
            workspaceIdentifier: record.workspaceIdentifier,
          }),
          { type: "complete" },
        );

        expect(requests).toHaveLength(1);
        const ownerQueue = createSyncExecutionQueue({
          url: new URL("execution", stack.authorityURL).href,
          workspaceIdentifier: record.workspaceIdentifier,
          headers: () => ({ authorization: `Bearer ${stack.auth}` }),
        });
        const collaboratorQueue = createSyncExecutionQueue({
          url: new URL("execution", stack.authorityURL).href,
          workspaceIdentifier: record.workspaceIdentifier,
          headers: () => ({ authorization: `Bearer ${stack.collaborator!.auth}` }),
        });
        const executorIdentifier = randomUUID();

        await expect(collaboratorQueue.claim({ executorIdentifier })).rejects.toThrow("HTTP 403");
        const firstClaim = await ownerQueue.claim({ executorIdentifier });

        if (!firstClaim) throw new Error("Sync execution test requires its first owner claim");

        expect(firstClaim.operationIdentifier).toBe(operation.operationIdentifier);
        expect(await ownerQueue.claim({ executorIdentifier: randomUUID() })).toBeNull();
        await ownerQueue.report({
          claim: firstClaim,
          observation: { status: "executing", reference: "owner-prompt" },
        });
        await ownerQueue.report({
          claim: firstClaim,
          observation: { status: "executing", reference: "owner-prompt" },
        });
        await expect(
          ownerQueue.report({ claim: firstClaim, observation: { status: "completed" } }),
        ).rejects.toThrow("HTTP 409");
        await expect(
          collaboratorQueue.report({ claim: firstClaim, observation: { status: "completed" } }),
        ).rejects.toThrow("HTTP 403");
        expect(requests[0]).toMatchObject({
          id: operation.operationIdentifier,
          requesterIdentifier: stack.collaborator.userID,
          status: "waiting-owner",
          action: "agent.prompt",
          input: { text: "Explain this plan" },
        });
        const replay = await submitSyncOperation({
          operation,
          submit: (request) => recovered.mutate(sharedWorkspaceMutators.execution.request(request)),
          lookup: (request) =>
            lookupSharedOperationReceipt({ ...stack, ...stack.collaborator!, operation: request }),
        });

        expect(replay.status).toBe("accepted");
        await stack.restartAuthority();
        let providerState: SyncExecutionObservation = {
          status: "executing",
          reference: "owner-prompt",
        };
        let dispatches = 0;
        const executor = {
          identifier: executorIdentifier,
          recover: async () => providerState,
          dispatch: async () => {
            dispatches++;

            return providerState;
          },
        };
        const deadline = Date.now() + 10000;
        let completed = false;

        providerState = { status: "completed", reference: "owner-prompt" };

        while (!completed && Date.now() < deadline) {
          const report = await advanceSyncExecution({ queue: ownerQueue, executor });

          completed = report?.observation.status === "completed";

          if (!completed) await Bun.sleep(20);
        }

        expect(completed).toBe(true);
        expect(dispatches).toBe(0);
        await expect(
          ownerQueue.report({
            claim: firstClaim,
            observation: { status: "failed", message: "stale owner" },
          }),
        ).rejects.toThrow("HTTP 409");
        await database`UPDATE sync_workspace_member SET role = 'viewer' WHERE workspace_identifier = ${record.workspaceIdentifier} AND user_identifier = ${stack.collaborator.userID}`;
        const denied = sharedExecutionOperations.request.create({
          authority: stack.authority,
          workspaceIdentifier: record.workspaceIdentifier,
          arguments: { recordIdentifier: record.id, text: "Viewer request" },
        });
        const rejected = await submitSyncOperation({
          operation: denied,
          submit: (request) => recovered.mutate(sharedWorkspaceMutators.execution.request(request)),
          lookup: (request) =>
            lookupSharedOperationReceipt({ ...stack, ...stack.collaborator!, operation: request }),
        });

        expect(rejected).toMatchObject({
          status: "rejected",
          reason: { status: "retained", code: "permission_denied" },
        });
        expect(
          await recovered.run(
            sharedWorkspaceQueries.executionRequests({
              workspaceIdentifier: record.workspaceIdentifier,
            }),
            { type: "complete" },
          ),
        ).toHaveLength(1);
      } finally {
        await recovered.close();
      }
    } finally {
      await editor?.close();
      await collaborator?.close();
      await reader.close();
      await database.end();
      await stack.close();
    }
  },
  120000,
);
