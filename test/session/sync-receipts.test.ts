import { expect, test } from "bun:test";
import postgres from "postgres";
import * as v from "valibot";
import { zeroPostgresJS } from "@rocicorp/zero/server/adapters/postgresjs";
import { createBuilder } from "@cueloop/sync/schema";
import { defineSyncOperation } from "@cueloop/sync/operations";
import {
  acceptSyncOperation,
  findSyncOperationReceipt,
  compactSyncOperationResults,
  SyncOperationRejection,
} from "@cueloop/sync/server";
import { createTestSyncStack } from "../helpers/sync-stack";
import { createSharedRecordClient } from "../../examples/sync-workspace/client.ts";
import {
  sharedRecordQueries,
  sharedRecordSchema,
} from "../../examples/sync-workspace/shared-record.ts";

const appendRecord = defineSyncOperation({
  name: "record.append",
  version: 1,
  arguments: v.object({ recordIdentifier: v.pipe(v.string(), v.uuid()), text: v.string() }),
});
const builder = createBuilder(sharedRecordSchema);

test.skipIf(process.env.CUELOOP_RUN_SYNC !== "1")(
  "concurrent retries return one accepted result and apply an append once",
  async () => {
    const stack = await createTestSyncStack();
    const connection = postgres(stack.environment.SYNC_DATABASE_URL);
    const database = zeroPostgresJS(sharedRecordSchema, connection);
    const client = createSharedRecordClient(stack);

    try {
      const [record] = await client.run(sharedRecordQueries.records(), { type: "complete" });

      if (!record) throw new Error("Sync receipt test requires its seeded record");

      const operation = appendRecord.create({
        workspaceIdentifier: record.workspaceIdentifier,
        arguments: { recordIdentifier: record.id, text: " plus one" },
      });
      const applied = Promise.withResolvers<void>();
      const view = client.materialize(sharedRecordQueries.records());
      const unsubscribe = view.addListener((records) => {
        if (records.some((value) => value.content === "Shared workspace plus one"))
          applied.resolve();
      });
      const applicationStarted = Promise.withResolvers<void>();
      const allowCommit = Promise.withResolvers<void>();
      const submit = (request = operation) =>
        database.transaction((transaction) =>
          acceptSyncOperation({
            transaction,
            definition: appendRecord,
            operation: JSON.parse(JSON.stringify(request)),
            actorIdentifier: stack.userID,
            authorize: async (receiptTransaction, acceptedOperation) => {
              const membership = await receiptTransaction.run(
                builder.sync_workspace_member
                  .where("workspaceIdentifier", acceptedOperation.workspaceIdentifier)
                  .where("userIdentifier", stack.userID)
                  .where("deletedAt", "IS", null)
                  .one(),
              );

              if (!membership) throw new Error("Sync receipt test membership is required");
            },
            apply: async (receiptTransaction, acceptedOperation) => {
              applicationStarted.resolve();
              await allowCommit.promise;
              const current = await receiptTransaction.run(
                builder.shared_record
                  .where("id", acceptedOperation.arguments.recordIdentifier)
                  .one(),
              );

              if (!current) throw new Error("Sync receipt test record is required");

              const content = current.content + acceptedOperation.arguments.text;

              await receiptTransaction.mutate.shared_record.update({ id: current.id, content });

              return { content };
            },
          }),
        );

      try {
        const initial = submit();

        await applicationStarted.promise;
        const retry = submit();
        const conflicting = submit({
          ...operation,
          arguments: { ...operation.arguments, text: " plus two" },
        });
        const attempts = Promise.allSettled([initial, retry, conflicting]);

        allowCommit.resolve();
        const [initialResult, retryResult, conflict] = await attempts;

        if (initialResult.status !== "fulfilled") throw initialResult.reason;

        if (retryResult.status !== "fulfilled") throw retryResult.reason;

        expect(conflict.status).toBe("rejected");

        if (conflict.status !== "rejected")
          throw new Error("Sync receipt test requires a conflicting identity rejection");

        expect(conflict.reason.message).toBe(
          "Sync operation identity conflicts with an existing request",
        );
        const first = initialResult.value;
        const second = retryResult.value;

        expect(first).toEqual(second);
        const recovered = await database.transaction((transaction) =>
          findSyncOperationReceipt({
            transaction,
            definition: appendRecord,
            operation: JSON.parse(JSON.stringify(operation)),
            actorIdentifier: stack.userID,
            authorize: async (receiptTransaction, acceptedOperation) => {
              const membership = await receiptTransaction.run(
                builder.sync_workspace_member
                  .where("workspaceIdentifier", acceptedOperation.workspaceIdentifier)
                  .where("userIdentifier", stack.userID)
                  .where("deletedAt", "IS", null)
                  .one(),
              );

              if (!membership) throw new Error("Sync receipt test membership is required");
            },
          }),
        );

        expect(recovered).toEqual(first);
        expect(first).toMatchObject({
          status: "accepted",
          operationIdentifier: operation.operationIdentifier,
          result: { status: "retained", value: { content: "Shared workspace plus one" } },
        });
        await applied.promise;
        expect((await client.run(sharedRecordQueries.records()))[0]?.content).toBe(
          "Shared workspace plus one",
        );
        await expect(
          submit({
            ...operation,
            arguments: { ...operation.arguments, text: " plus two" },
          }),
        ).rejects.toThrow("Sync operation identity conflicts with an existing request");
        expect((await client.run(sharedRecordQueries.records()))[0]?.content).toBe(
          "Shared workspace plus one",
        );
      } finally {
        allowCommit.resolve();
        unsubscribe();
        view.destroy();
      }
    } finally {
      await client.close();
      await connection.end();
      await stack.close();
    }
  },
  120000,
);

test.skipIf(process.env.CUELOOP_RUN_SYNC !== "1")(
  "a request that expires during authorization cannot commit its change",
  async () => {
    const stack = await createTestSyncStack();
    const connection = postgres(stack.environment.SYNC_DATABASE_URL);
    const database = zeroPostgresJS(sharedRecordSchema, connection);
    const client = createSharedRecordClient(stack);
    let authorityTime = 1700000000000;

    try {
      const [record] = await client.run(sharedRecordQueries.records(), { type: "complete" });

      if (!record) throw new Error("Sync expiry test requires its seeded record");

      const operation = appendRecord.create({
        workspaceIdentifier: record.workspaceIdentifier,
        arguments: { recordIdentifier: record.id, text: " expired" },
        requestLifetimeMilliseconds: 1000,
        now: () => authorityTime,
      });
      const attempt = database.transaction((transaction) =>
        acceptSyncOperation({
          transaction,
          definition: appendRecord,
          operation,
          actorIdentifier: stack.userID,
          now: () => authorityTime,
          authorize: async (receiptTransaction, acceptedOperation) => {
            const membership = await receiptTransaction.run(
              builder.sync_workspace_member
                .where("workspaceIdentifier", acceptedOperation.workspaceIdentifier)
                .where("userIdentifier", stack.userID)
                .where("deletedAt", "IS", null)
                .one(),
            );

            if (!membership) throw new Error("Sync expiry test membership is required");

            authorityTime = 1700000002000;
          },
          apply: async (receiptTransaction, acceptedOperation) => {
            await receiptTransaction.mutate.shared_record.update({
              id: acceptedOperation.arguments.recordIdentifier,
              content: "Expired request was applied",
            });

            return { content: "Expired request was applied" };
          },
        }),
      );

      expect(await attempt).toMatchObject({
        status: "rejected",
        reason: { status: "retained", code: "request_expired" },
      });
      expect(
        (await database.run(builder.shared_record.where("id", record.id).one()))?.content,
      ).toBe("Shared workspace");
    } finally {
      await client.close();
      await connection.end();
      await stack.close();
    }
  },
  120000,
);

test.skipIf(process.env.CUELOOP_RUN_SYNC !== "1")(
  "a failed transaction rolls back its data and receipt before an explicit retry",
  async () => {
    const stack = await createTestSyncStack();
    const connection = postgres(stack.environment.SYNC_DATABASE_URL);
    const database = zeroPostgresJS(sharedRecordSchema, connection);
    const client = createSharedRecordClient(stack);

    try {
      const [record] = await client.run(sharedRecordQueries.records(), { type: "complete" });

      if (!record) throw new Error("Sync rollback test requires its seeded record");

      const operation = appendRecord.create({
        workspaceIdentifier: record.workspaceIdentifier,
        arguments: { recordIdentifier: record.id, text: " after retry" },
      });
      const submit = (failAfterWrite: boolean) =>
        database.transaction((transaction) =>
          acceptSyncOperation({
            transaction,
            definition: appendRecord,
            operation,
            actorIdentifier: stack.userID,
            authorize: async (receiptTransaction, acceptedOperation) => {
              const membership = await receiptTransaction.run(
                builder.sync_workspace_member
                  .where("workspaceIdentifier", acceptedOperation.workspaceIdentifier)
                  .where("userIdentifier", stack.userID)
                  .where("deletedAt", "IS", null)
                  .one(),
              );

              if (!membership) throw new Error("Sync rollback test membership is required");
            },
            apply: async (receiptTransaction, acceptedOperation) => {
              const current = await receiptTransaction.run(
                builder.shared_record.where("id", record.id).one(),
              );

              if (!current) throw new Error("Sync rollback test record is required");

              const content = current.content + acceptedOperation.arguments.text;

              await receiptTransaction.mutate.shared_record.update({ id: current.id, content });

              if (failAfterWrite) throw new Error("Application rejected the transaction");

              return { content };
            },
          }),
        );

      await expect(submit(true)).rejects.toThrow("Application rejected the transaction");
      expect(
        (await database.run(builder.shared_record.where("id", record.id).one()))?.content,
      ).toBe("Shared workspace");
      const retried = await submit(false);

      expect(retried).toMatchObject({
        status: "accepted",
        result: { status: "retained", value: { content: "Shared workspace after retry" } },
      });
      expect(
        (await database.run(builder.shared_record.where("id", record.id).one()))?.content,
      ).toBe("Shared workspace after retry");
    } finally {
      await client.close();
      await connection.end();
      await stack.close();
    }
  },
  120000,
);

test.skipIf(process.env.CUELOOP_RUN_SYNC !== "1")(
  "receipt compaction preserves acceptance and never releases an operation identity",
  async () => {
    const stack = await createTestSyncStack();
    const connection = postgres(stack.environment.SYNC_DATABASE_URL);
    const database = zeroPostgresJS(sharedRecordSchema, connection);
    const client = createSharedRecordClient(stack);
    let authorityTime = 1700000000000;

    try {
      const [record] = await client.run(sharedRecordQueries.records(), { type: "complete" });

      if (!record) throw new Error("Sync retention test requires its seeded record");

      const operation = appendRecord.create({
        workspaceIdentifier: record.workspaceIdentifier,
        arguments: { recordIdentifier: record.id, text: " retained once" },
        requestLifetimeMilliseconds: 1000,
        now: () => authorityTime,
      });
      const submit = (request = operation) =>
        database.transaction((transaction) =>
          acceptSyncOperation({
            transaction,
            definition: appendRecord,
            operation: request,
            actorIdentifier: stack.userID,
            now: () => authorityTime,
            resultRetentionMilliseconds: 5000,
            authorize: async (receiptTransaction, acceptedOperation) => {
              const membership = await receiptTransaction.run(
                builder.sync_workspace_member
                  .where("workspaceIdentifier", acceptedOperation.workspaceIdentifier)
                  .where("userIdentifier", stack.userID)
                  .where("deletedAt", "IS", null)
                  .one(),
              );

              if (!membership) throw new Error("Sync retention test membership is required");
            },
            apply: async (receiptTransaction, acceptedOperation) => {
              const current = await receiptTransaction.run(
                builder.shared_record.where("id", record.id).one(),
              );

              if (!current) throw new Error("Sync retention test record is required");

              const content = current.content + acceptedOperation.arguments.text;

              await receiptTransaction.mutate.shared_record.update({ id: current.id, content });

              return { content };
            },
          }),
        );
      const accepted = await submit();

      authorityTime = 1700000002000;
      expect(await submit()).toEqual(accepted);
      authorityTime = 1700000006000;
      const compact = () =>
        database.transaction((transaction) =>
          compactSyncOperationResults({
            transaction,
            workspaceIdentifier: record.workspaceIdentifier,
            now: () => authorityTime,
            authorize: async (maintenanceTransaction, workspaceIdentifier) => {
              const owner = await maintenanceTransaction.run(
                builder.sync_workspace_member
                  .where("workspaceIdentifier", workspaceIdentifier)
                  .where("userIdentifier", stack.userID)
                  .where("role", "owner")
                  .where("deletedAt", "IS", null)
                  .one(),
              );

              if (!owner) throw new Error("Sync retention test owner is required");
            },
          }),
        );

      expect(await compact()).toBe(1);
      expect(await compact()).toBe(0);
      expect(await submit()).toMatchObject({
        status: "accepted",
        operationIdentifier: operation.operationIdentifier,
        acceptedAt: 1700000000000,
        result: { status: "expired" },
      });
      await expect(
        submit({ ...operation, arguments: { ...operation.arguments, text: " reused" } }),
      ).rejects.toThrow("Sync operation identity conflicts with an existing request");
      expect(
        (await database.run(builder.shared_record.where("id", record.id).one()))?.content,
      ).toBe("Shared workspace retained once");
    } finally {
      await client.close();
      await connection.end();
      await stack.close();
    }
  },
  120000,
);

test.skipIf(process.env.CUELOOP_RUN_SYNC !== "1")(
  "an application rejection rolls back its changes and keeps the request rejected on retry",
  async () => {
    const stack = await createTestSyncStack();
    const connection = postgres(stack.environment.SYNC_DATABASE_URL);
    const database = zeroPostgresJS(sharedRecordSchema, connection);
    const client = createSharedRecordClient(stack);

    try {
      const [record] = await client.run(sharedRecordQueries.records(), { type: "complete" });

      if (!record) throw new Error("Sync rejection test requires its seeded record");

      const operation = appendRecord.create({
        workspaceIdentifier: record.workspaceIdentifier,
        arguments: { recordIdentifier: record.id, text: " rejected" },
      });
      const submit = (reject: boolean) =>
        database.transaction((transaction) =>
          acceptSyncOperation({
            transaction,
            definition: appendRecord,
            operation,
            actorIdentifier: stack.userID,
            authorize: async (receiptTransaction, acceptedOperation) => {
              const membership = await receiptTransaction.run(
                builder.sync_workspace_member
                  .where("workspaceIdentifier", acceptedOperation.workspaceIdentifier)
                  .where("userIdentifier", stack.userID)
                  .where("deletedAt", "IS", null)
                  .one(),
              );

              if (!membership) throw new Error("Sync rejection test membership is required");
            },
            apply: async (receiptTransaction) => {
              await receiptTransaction.mutate.shared_record.update({
                id: record.id,
                content: "Rejected write",
              });

              if (reject)
                throw new SyncOperationRejection({
                  code: "comments_closed",
                  message: "Comments are closed",
                });

              return { content: "Rejected write" };
            },
          }),
        );
      const rejected = await submit(true);

      expect(rejected).toMatchObject({
        status: "rejected",
        operationIdentifier: operation.operationIdentifier,
        reason: { status: "retained", code: "comments_closed", message: "Comments are closed" },
      });
      expect(
        (await database.run(builder.shared_record.where("id", record.id).one()))?.content,
      ).toBe("Shared workspace");
      expect(await submit(false)).toEqual(rejected);
      expect(
        (await database.run(builder.shared_record.where("id", record.id).one()))?.content,
      ).toBe("Shared workspace");
    } finally {
      await client.close();
      await connection.end();
      await stack.close();
    }
  },
  120000,
);
