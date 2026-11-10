import { expect, test } from "bun:test";
import * as v from "valibot";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import postgres from "postgres";
import { SyncOperationReceiptSchema, submitSyncOperation } from "@cueloop/sync/operations";
import { createTestSyncStack } from "../helpers/sync-stack";
import { createSharedRecordClient } from "../../examples/sync-workspace/client.ts";
import { sharedRecordQueries } from "../../examples/sync-workspace/shared-record.ts";
import {
  sharedCommentOperations,
  sharedWorkspaceQueries,
  sharedWorkspaceMutators,
} from "../../examples/sync-workspace/shared-workspace.ts";

test.skipIf(process.env.CUELOOP_RUN_SYNC !== "1")(
  "comment creation, editing, and removal return stable receipts through the real sync protocol",
  async () => {
    const stack = await createTestSyncStack();
    const writer = createSharedRecordClient(stack);
    const observer = createSharedRecordClient(stack);

    try {
      const [record] = await writer.run(sharedRecordQueries.records(), { type: "complete" });

      if (!record) throw new Error("Sync comment test requires its seeded record");

      const query = sharedWorkspaceQueries.comments({
        workspaceIdentifier: record.workspaceIdentifier,
        recordIdentifier: record.id,
      });
      const view = observer.materialize(query);
      const waitForComments = (expected: { body: string; revision: number }[]) => {
        const observed = Promise.withResolvers<void>();
        const unsubscribe = view.addListener((comments) => {
          if (
            comments.length === expected.length &&
            comments.every(
              (comment, index) =>
                comment.body === expected[index]?.body &&
                comment.revision === expected[index]?.revision,
            )
          )
            observed.resolve();
        });

        return waitForTestMutationPhase(observed.promise, "the expected comments").finally(
          unsubscribe,
        );
      };

      try {
        await observer.run(query, { type: "complete" });
        const creation = sharedCommentOperations.add.create({
          authority: stack.authority,
          workspaceIdentifier: record.workspaceIdentifier,
          arguments: { recordIdentifier: record.id, body: "Explain cancellation" },
        });
        const acceptedCreation = await submitSyncOperation({
          operation: creation,
          submit: (operation) => writer.mutate(sharedWorkspaceMutators.comment.add(operation)),
        });

        expect(acceptedCreation).toMatchObject({
          status: "accepted",
          operationIdentifier: creation.operationIdentifier,
        });

        if (acceptedCreation.status !== "accepted")
          throw new Error("Sync comment creation requires an accepted receipt");

        const repeatedCreation = await writer.mutate(sharedWorkspaceMutators.comment.add(creation))
          .server;

        expect(repeatedCreation).toMatchObject({ type: "success", data: acceptedCreation });
        const configuration = join(stack.directory, "experimental.toml");
        const savedOperation = join(stack.directory, "comment-add.json");

        writeFileSync(configuration, "[experimental]\nsync = true\n");
        writeFileSync(savedOperation, JSON.stringify(creation));

        const changedCreation = {
          ...creation,
          arguments: { ...creation.arguments, body: "Conflicting request body" },
        };

        await expect(
          submitSyncOperation({
            operation: changedCreation,
            submit: (operation) => writer.mutate(sharedWorkspaceMutators.comment.add(operation)),
          }),
        ).rejects.toThrow("Sync operation identity conflicts with an existing request");

        for (const command of [
          { flags: [], conflict: false },
          { flags: ["--operation-status"], conflict: false },
          { flags: [], conflict: true },
        ]) {
          writeFileSync(
            savedOperation,
            JSON.stringify(command.conflict ? changedCreation : creation),
          );
          const child = Bun.spawn(
            [
              process.execPath,
              "packages/cli/src/main.ts",
              "sync",
              "connect",
              "--application",
              "examples/sync-workspace/authority.ts",
              "--operation",
              savedOperation,
              ...command.flags,
            ],
            {
              env: { ...stack.environment, CUELOOP_CONFIG: configuration },
              stdout: "pipe",
              stderr: "pipe",
              signal: AbortSignal.timeout(30000),
            },
          );
          const [output, error, status] = await Promise.all([
            new Response(child.stdout).text(),
            new Response(child.stderr).text(),
            child.exited,
          ]);

          expect(
            status,
            error
              .replaceAll(stack.auth, "[redacted]")
              .replaceAll(stack.environment.SYNC_DATABASE_URL, "[redacted]"),
          ).toBe(command.conflict ? 1 : 0);

          if (command.conflict) {
            expect(error).toContain("Sync operation identity conflicts with an existing request");
            expect(output).toBe("");
          } else {
            expect(v.parse(SyncOperationReceiptSchema, JSON.parse(output))).toEqual(
              acceptedCreation,
            );
          }
        }

        await waitForComments([{ body: "Explain cancellation", revision: 1 }]);
        expect((await observer.run(query))[0]?.authorIdentifier).toBe(stack.userID);
        const edit = sharedCommentOperations.edit.create({
          authority: stack.authority,
          workspaceIdentifier: record.workspaceIdentifier,
          arguments: {
            commentIdentifier: creation.operationIdentifier,
            expectedRevision: 1,
            body: "Explain cancellation and cleanup",
          },
        });
        const edited = await writer.mutate(sharedWorkspaceMutators.comment.edit(edit)).server;

        if (edited.type !== "success") throw new Error(edited.error.message);

        const acceptedEdit = v.parse(SyncOperationReceiptSchema, edited.data);

        expect(acceptedEdit).toMatchObject({
          status: "accepted",
          result: { status: "retained", value: { revision: 2 } },
        });
        expect(
          await writer.mutate(sharedWorkspaceMutators.comment.edit(edit)).server,
        ).toMatchObject({ type: "success", data: acceptedEdit });
        await waitForComments([{ body: "Explain cancellation and cleanup", revision: 2 }]);
        const staleEdit = sharedCommentOperations.edit.create({
          authority: stack.authority,
          workspaceIdentifier: record.workspaceIdentifier,
          arguments: {
            commentIdentifier: creation.operationIdentifier,
            expectedRevision: 1,
            body: "Stale edit",
          },
        });
        const rejected = await submitSyncOperation({
          operation: staleEdit,
          submit: (operation) => writer.mutate(sharedWorkspaceMutators.comment.edit(operation)),
        });

        expect(rejected).toMatchObject({
          status: "rejected",
          reason: { status: "retained", code: "revision_conflict" },
        });
        expect((await observer.run(query))[0]?.body).toBe("Explain cancellation and cleanup");
        const removal = sharedCommentOperations.remove.create({
          authority: stack.authority,
          workspaceIdentifier: record.workspaceIdentifier,
          arguments: { commentIdentifier: creation.operationIdentifier, expectedRevision: 2 },
        });
        const removed = await writer.mutate(sharedWorkspaceMutators.comment.remove(removal)).server;

        if (removed.type !== "success") throw new Error(removed.error.message);

        const acceptedRemoval = v.parse(SyncOperationReceiptSchema, removed.data);

        expect(acceptedRemoval).toMatchObject({
          status: "accepted",
          result: { status: "retained", value: { removed: true } },
        });
        expect(
          await writer.mutate(sharedWorkspaceMutators.comment.remove(removal)).server,
        ).toMatchObject({ type: "success", data: acceptedRemoval });
        await waitForComments([]);
        expect(await observer.run(query)).toEqual([]);
      } finally {
        view.destroy();
      }
    } finally {
      await writer.close();
      await observer.close();
      await stack.close();
    }
  },
  120000,
);

function waitForTestMutationPhase(phase: Promise<void>, label: string): Promise<void> {
  const expired = Promise.withResolvers<void>();
  const timer = setTimeout(
    () => expired.reject(new Error(`Sync comment test timed out waiting for ${label}`)),
    30000,
  );

  return Promise.race([phase, expired.promise]).finally(() => clearTimeout(timer));
}

test.skipIf(process.env.CUELOOP_RUN_SYNC !== "1")(
  "a lost edit acknowledgement recovers its original receipt after client and authority restart",
  async () => {
    const stack = await createTestSyncStack({ interceptMutations: true });
    let writer: ReturnType<typeof createSharedRecordClient> | undefined =
      createSharedRecordClient(stack);
    let recovered: ReturnType<typeof createSharedRecordClient> | undefined;
    const observer = createSharedRecordClient(stack);
    let forwardPendingMutation = () => {};

    try {
      const [record] = await writer.run(sharedRecordQueries.records(), { type: "complete" });

      if (!record) throw new Error("Sync restart test requires its seeded record");

      const query = sharedWorkspaceQueries.comments({
        workspaceIdentifier: record.workspaceIdentifier,
        recordIdentifier: record.id,
      });
      const creation = sharedCommentOperations.add.create({
        authority: stack.authority,
        workspaceIdentifier: record.workspaceIdentifier,
        arguments: { recordIdentifier: record.id, body: "Before disconnect" },
      });
      const created = await writer.mutate(sharedWorkspaceMutators.comment.add(creation)).server;

      expect(created.type).toBe("success");
      await observer.run(query, { type: "complete" });
      const view = observer.materialize(query);
      const observed = Promise.withResolvers<void>();
      const unsubscribe = view.addListener((comments) => {
        if (
          comments.length === 1 &&
          comments[0]?.body === "Accepted while disconnected" &&
          comments[0]?.revision === 2
        )
          observed.resolve();
      });

      try {
        const edit = sharedCommentOperations.edit.create({
          authority: stack.authority,
          workspaceIdentifier: record.workspaceIdentifier,
          arguments: {
            commentIdentifier: creation.operationIdentifier,
            expectedRevision: 1,
            body: "Accepted while disconnected",
          },
        });
        const serialized = JSON.stringify(edit);
        const paused = stack.pauseNextMutation();

        forwardPendingMutation = paused.forward;
        const attempt = writer.mutate(sharedWorkspaceMutators.comment.edit(edit));

        expect((await attempt.client).type).toBe("success");
        await waitForTestMutationPhase(paused.received, "the submitted mutation");
        const disconnected = writer;

        writer = undefined;
        await waitForTestMutationPhase(disconnected.close(), "the original client to close");
        paused.forward();
        await waitForTestMutationPhase(paused.processed, "authority processing after disconnect");
        await waitForTestMutationPhase(
          observed.promise,
          "the committed edit on an independent client",
        );
        const response = await fetch(`${stack.authorityURL}/operation`, {
          method: "POST",
          headers: { authorization: `Bearer ${stack.auth}`, "content-type": "application/json" },
          body: serialized,
          signal: AbortSignal.timeout(30000),
        });

        expect(response.status).toBe(200);
        const original = v.parse(
          v.object({ receipt: v.nullable(SyncOperationReceiptSchema) }),
          await response.json(),
        ).receipt;

        expect(original).toMatchObject({
          status: "accepted",
          result: { status: "retained", value: { revision: 2 } },
        });
        await stack.restartAuthority();
        recovered = createSharedRecordClient({
          ...stack,
          storageKey: `${stack.storageKey}-recovered`,
        });
        await recovered.run(sharedRecordQueries.records(), { type: "complete" });
        const request = sharedCommentOperations.edit.parse(JSON.parse(serialized));
        const retried = await recovered.mutate(sharedWorkspaceMutators.comment.edit(request))
          .server;

        if (retried.type !== "success") throw new Error(retried.error.message);

        const lookup =
          retried.data === undefined
            ? v.parse(
                v.object({ receipt: v.nullable(SyncOperationReceiptSchema) }),
                await (
                  await fetch(`${stack.authorityURL}/operation`, {
                    method: "POST",
                    headers: {
                      authorization: `Bearer ${stack.auth}`,
                      "content-type": "application/json",
                    },
                    body: serialized,
                    signal: AbortSignal.timeout(30000),
                  })
                ).json(),
              ).receipt
            : v.parse(SyncOperationReceiptSchema, retried.data);

        expect(lookup).toEqual(original);
        expect(
          (await observer.run(query)).map((comment) => ({
            body: comment.body,
            revision: comment.revision,
          })),
        ).toEqual([{ body: "Accepted while disconnected", revision: 2 }]);
      } finally {
        unsubscribe();
        view.destroy();
      }
    } finally {
      forwardPendingMutation();

      try {
        await writer?.close();
        await recovered?.close();
        await observer.close();
      } finally {
        await stack.close();
      }
    }
  },
  120000,
);

test.skipIf(process.env.CUELOOP_RUN_SYNC !== "1")(
  "concurrent comment edits accept one revision and preserve the other request's rejection",
  async () => {
    const stack = await createTestSyncStack();
    const firstWriter = createSharedRecordClient({
      ...stack,
      storageKey: `${stack.storageKey}-first`,
    });
    const secondWriter = createSharedRecordClient({
      ...stack,
      storageKey: `${stack.storageKey}-second`,
    });

    try {
      const [record] = await firstWriter.run(sharedRecordQueries.records(), { type: "complete" });

      if (!record) throw new Error("Sync concurrent edit test requires its seeded record");

      await secondWriter.run(sharedRecordQueries.records(), { type: "complete" });
      const creation = sharedCommentOperations.add.create({
        authority: stack.authority,
        workspaceIdentifier: record.workspaceIdentifier,
        arguments: { recordIdentifier: record.id, body: "Original" },
      });
      const created = await firstWriter.mutate(sharedWorkspaceMutators.comment.add(creation))
        .server;

      expect(created.type).toBe("success");
      const requests = ["First edit", "Second edit"].map((body) =>
        sharedCommentOperations.edit.create({
          authority: stack.authority,
          workspaceIdentifier: record.workspaceIdentifier,
          arguments: { commentIdentifier: creation.operationIdentifier, expectedRevision: 1, body },
        }),
      );
      const first = requests[0]!;
      const second = requests[1]!;
      const results = await Promise.all([
        submitSyncOperation({
          operation: first,
          submit: (operation) =>
            firstWriter.mutate(sharedWorkspaceMutators.comment.edit(operation)),
        }),
        submitSyncOperation({
          operation: second,
          submit: (operation) =>
            secondWriter.mutate(sharedWorkspaceMutators.comment.edit(operation)),
        }),
      ]);

      expect(results.map((result) => result.status).sort()).toEqual(["accepted", "rejected"]);
      const rejected = results.find((result) => result.status === "rejected");

      expect(rejected).toMatchObject({ reason: { status: "retained", code: "revision_conflict" } });

      if (!rejected) throw new Error("Sync concurrent edit test requires a rejection");

      const failedRequest = requests.find(
        (request) => request.operationIdentifier === rejected?.operationIdentifier,
      );

      if (!failedRequest) throw new Error("Sync concurrent edit test requires a rejected request");

      expect(
        await submitSyncOperation({
          operation: failedRequest,
          submit: (operation) =>
            secondWriter.mutate(sharedWorkspaceMutators.comment.edit(operation)),
        }),
      ).toEqual(rejected);
    } finally {
      await firstWriter.close();
      await secondWriter.close();
      await stack.close();
    }
  },
  120000,
);

test.skipIf(process.env.CUELOOP_RUN_SYNC !== "1")(
  "receipt recovery checks current membership while viewers receive a durable write rejection",
  async () => {
    const stack = await createTestSyncStack();
    const client = createSharedRecordClient(stack);
    const database = postgres(stack.environment.SYNC_DATABASE_URL);

    try {
      const [record] = await client.run(sharedRecordQueries.records(), { type: "complete" });

      if (!record) throw new Error("Sync receipt authorization test requires its seeded record");

      const creation = sharedCommentOperations.add.create({
        authority: stack.authority,
        workspaceIdentifier: record.workspaceIdentifier,
        arguments: { recordIdentifier: record.id, body: "Authorized original" },
      });
      const accepted = await submitSyncOperation({
        operation: creation,
        submit: (operation) => client.mutate(sharedWorkspaceMutators.comment.add(operation)),
      });

      expect(accepted.status).toBe("accepted");

      if (accepted.status !== "accepted")
        throw new Error("Sync authorization test requires an accepted receipt");

      await database`UPDATE sync_workspace_member SET role = 'viewer' WHERE workspace_identifier = ${record.workspaceIdentifier} AND user_identifier = ${stack.userID}`;
      const deniedCreation = sharedCommentOperations.add.create({
        authority: stack.authority,
        workspaceIdentifier: record.workspaceIdentifier,
        arguments: { recordIdentifier: record.id, body: "Viewer write" },
      });
      const rejected = await submitSyncOperation({
        operation: deniedCreation,
        submit: (operation) => client.mutate(sharedWorkspaceMutators.comment.add(operation)),
      });

      expect(rejected).toMatchObject({
        status: "rejected",
        reason: { status: "retained", code: "permission_denied" },
      });
      const lookup = () =>
        fetch(`${stack.authorityURL}/operation`, {
          method: "POST",
          headers: { authorization: `Bearer ${stack.auth}`, "content-type": "application/json" },
          body: JSON.stringify(creation),
          signal: AbortSignal.timeout(30000),
        });
      const visible = await lookup();

      expect(visible.status).toBe(200);
      expect(
        v.parse(v.object({ receipt: SyncOperationReceiptSchema }), await visible.json()).receipt,
      ).toEqual(accepted);
      await database`UPDATE sync_workspace_member SET deleted_at = clock_timestamp() WHERE workspace_identifier = ${record.workspaceIdentifier} AND user_identifier = ${stack.userID}`;
      const revoked = await lookup();

      expect(revoked.status).toBe(403);
      expect(await revoked.json()).toEqual({ error: "forbidden" });
    } finally {
      await client.close();
      await database.end();
      await stack.close();
    }
  },
  120000,
);
