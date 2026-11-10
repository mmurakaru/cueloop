import { expect, test } from "bun:test";
import { join } from "node:path";
import * as v from "valibot";
import { createSyncDraftStore } from "@cueloop/sync/drafts";
import { createSyncSqliteStorage } from "@cueloop/sync/storage";
import { SyncOperationReceiptSchema } from "@cueloop/sync/operations";
import { createTestSyncStack } from "../helpers/sync-stack";
import { createTestSyncProxy } from "../helpers/sync-proxy";
import { waitForTestSyncState } from "../helpers/sync-test-deadline";
import { createSharedRecordClient } from "../../examples/sync-workspace/client.ts";
import { sharedRecordQueries } from "../../examples/sync-workspace/shared-record.ts";
import {
  sharedWorkspaceQueries,
  sharedWorkspaceMutators,
  sharedCommentOperations,
} from "../../examples/sync-workspace/shared-workspace.ts";

test.skipIf(process.env.CUELOOP_RUN_SYNC !== "1")(
  "an accepted receipt preserves optimistic text until the replica receives its authoritative edit",
  async () => {
    const stack = await createTestSyncStack();
    const proxy = await createTestSyncProxy(stack.cacheURL);
    const writer = createSharedRecordClient({
      ...stack,
      cacheURL: proxy.cacheURL,
      storageKey: `${stack.storageKey}-writer`,
    });
    const observer = createSharedRecordClient({
      ...stack,
      storageKey: `${stack.storageKey}-observer`,
    });
    const drafts = createSyncDraftStore({
      storage: createSyncSqliteStorage({ directory: join(stack.directory, "drafts") }),
      authorityIdentifier: stack.authorityURL,
      userIdentifier: stack.userID,
    });

    try {
      const [record] = await writer.run(sharedRecordQueries.records(), { type: "complete" });

      if (!record) throw new Error("Sync optimism test requires its seeded record");

      const query = sharedWorkspaceQueries.comments({
        workspaceIdentifier: record.workspaceIdentifier,
        recordIdentifier: record.id,
      });
      const creation = sharedCommentOperations.add.create({
        authority: stack.authority,
        workspaceIdentifier: record.workspaceIdentifier,
        arguments: { recordIdentifier: record.id, body: "Original comment" },
      });

      expect((await writer.mutate(sharedWorkspaceMutators.comment.add(creation)).server).type).toBe(
        "success",
      );
      await writer.run(query, { type: "complete" });
      await observer.run(query, { type: "complete" });
      const writerView = writer.materialize(query);
      const observerView = observer.materialize(query);
      const applied = Promise.withResolvers<void>();
      const states: string[] = [];
      let capture = false;
      const unsubscribeWriter = writerView.addListener((comments) => {
        if (capture) states.push(comments[0]?.body ?? "missing");
      });
      const unsubscribeObserver = observerView.addListener((comments) => {
        if (comments[0]?.body === "Accepted before replication" && comments[0].revision === 2)
          applied.resolve();
      });

      try {
        const saved = await drafts.save({ content: { body: "Accepted before replication" } });
        const operation = sharedCommentOperations.edit.create({
          authority: stack.authority,
          workspaceIdentifier: record.workspaceIdentifier,
          arguments: {
            commentIdentifier: creation.operationIdentifier,
            expectedRevision: 1,
            body: "Accepted before replication",
          },
        });

        await drafts.markSubmitted({ draftIdentifier: saved.draftIdentifier, operation });
        proxy.pauseServerOutput();
        const attempt = writer.mutate(sharedWorkspaceMutators.comment.edit(operation));

        expect((await attempt.client).type).toBe("success");
        capture = true;
        expect((await writer.run(query))[0]?.body).toBe("Accepted before replication");
        await waitForTestSyncState(applied.promise, "the accepted edit on an independent replica");
        const response = await fetch(`${stack.authorityURL}/operation`, {
          method: "POST",
          headers: { authorization: `Bearer ${stack.auth}`, "content-type": "application/json" },
          body: JSON.stringify(operation),
          signal: AbortSignal.timeout(30000),
        });

        expect(response.status).toBe(200);
        const receipt = v.parse(
          v.object({ receipt: SyncOperationReceiptSchema }),
          await response.json(),
        ).receipt;

        expect(receipt.status).toBe("accepted");
        const accepted = await drafts.recordReceipt({
          draftIdentifier: saved.draftIdentifier,
          receipt,
        });

        expect(accepted.status).toBe("accepted");
        expect((await writer.run(query))[0]?.body).toBe("Accepted before replication");
        proxy.resumeServerOutput();
        expect(
          (await waitForTestSyncState(attempt.server, "the writer acknowledgement")).type,
        ).toBe("success");
        expect((await writer.run(query, { type: "complete" }))[0]?.revision).toBe(2);
        expect(states.every((body) => body === "Accepted before replication")).toBe(true);
      } finally {
        proxy.resumeServerOutput();
        unsubscribeWriter();
        unsubscribeObserver();
        writerView.destroy();
        observerView.destroy();
      }
    } finally {
      await writer.close();
      await observer.close();
      await drafts.close();
      await proxy.close();
      await stack.close();
    }
  },
  120000,
);
