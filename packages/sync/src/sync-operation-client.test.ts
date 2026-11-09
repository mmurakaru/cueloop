import { expect, test } from "bun:test";
import * as v from "valibot";
import { defineSyncOperation } from "./sync-operation.ts";
import { submitSyncOperation } from "./sync-operation-client.ts";

const comment = defineSyncOperation({
  name: "comment.add",
  version: 1,
  arguments: v.object({ body: v.string() }),
});

test("a missing acknowledgement remains pending without resubmitting the operation", async () => {
  const operation = comment.create({
    workspaceIdentifier: "019a6650-0000-7000-8000-000000000001",
    arguments: { body: "Retain this draft" },
  });
  let submissions = 0;
  const outcome = await submitSyncOperation({
    operation,
    acknowledgementTimeoutMilliseconds: 10,
    submit() {
      submissions += 1;

      return {
        client: Promise.resolve({ type: "success" }),
        server: new Promise(() => {}),
      };
    },
  });

  expect(outcome).toEqual({
    status: "pending",
    operationIdentifier: operation.operationIdentifier,
    workspaceIdentifier: operation.workspaceIdentifier,
  });
  expect(submissions).toBe(1);
});

test("a recovered receipt identifies the saved request when the protocol reply has no result", async () => {
  const operation = comment.create({
    workspaceIdentifier: "019a6650-0000-7000-8000-000000000001",
    arguments: { body: "Retain this draft" },
  });
  const outcome = await submitSyncOperation({
    operation,
    submit: () => ({
      client: Promise.resolve({ type: "success" }),
      server: Promise.resolve({ type: "success" }),
    }),
    lookup: async (request) => ({
      status: "accepted",
      operationIdentifier: request.operationIdentifier,
      workspaceIdentifier: request.workspaceIdentifier,
      acceptedAt: 1700000001000,
      result: { status: "retained", value: { revision: 1 } },
    }),
  });

  expect(outcome).toEqual({
    status: "accepted",
    operationIdentifier: operation.operationIdentifier,
    workspaceIdentifier: operation.workspaceIdentifier,
    acceptedAt: 1700000001000,
    result: { status: "retained", value: { revision: 1 } },
  });
});

test("an authoritative identity conflict fails explicitly rather than remaining pending", async () => {
  const operation = comment.create({
    workspaceIdentifier: "019a6650-0000-7000-8000-000000000001",
    arguments: { body: "Changed arguments for a saved identity" },
  });

  await expect(
    submitSyncOperation({
      operation,
      submit: () => ({
        client: Promise.resolve({ type: "success" }),
        server: Promise.resolve({
          type: "error",
          error: {
            type: "app",
            message: "Sync operation identity conflicts with an existing request",
            details: { name: "SyncOperationConflict" },
          },
        }),
      }),
    }),
  ).rejects.toThrow("Sync operation identity conflicts with an existing request");
});
