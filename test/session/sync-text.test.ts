import { expect, test } from "bun:test";
import { waitForTestSyncState } from "../helpers/sync-test-deadline";
import { createTestSyncStack } from "../helpers/sync-stack";
import { createSharedRecordClient } from "../../examples/sync-workspace/client.ts";
import { sharedRecordQueries } from "../../examples/sync-workspace/shared-record.ts";
import {
  sharedWorkspaceMutators,
  sharedWorkspaceQueries,
  sharedTextOperations,
} from "../../examples/sync-workspace/shared-workspace.ts";
import { createSyncTextDocument, createSyncTextState, readSyncTextState } from "@cueloop/sync/text";
import { submitSyncOperation } from "@cueloop/sync/operations";

test.skipIf(process.env.CUELOOP_RUN_SYNC !== "1")(
  "concurrent authorized text edits converge after acceptance and authority restart",
  async () => {
    const stack = await createTestSyncStack({ collaborator: true });

    if (!stack.collaborator)
      throw new Error("Sync text test requires its collaborator credentials");

    const alice = createSharedRecordClient({ ...stack, storageKey: `${stack.storageKey}-alice` });
    const bob = createSharedRecordClient({
      ...stack,
      ...stack.collaborator,
      storageKey: `${stack.storageKey}-bob`,
    });

    try {
      const query = sharedRecordQueries.records();
      const [original] = await alice.run(query, { type: "complete" });

      if (!original) throw new Error("Sync text test requires its seeded record");

      const initialized = await submitSyncOperation({
        operation: sharedTextOperations.initialize.create({
          authority: stack.authority,
          workspaceIdentifier: original.workspaceIdentifier,
          arguments: {
            recordIdentifier: original.id,
            state: createSyncTextState(original.content).state,
          },
        }),
        submit: (operation) => alice.mutate(sharedWorkspaceMutators.text.initialize(operation)),
      });

      expect(initialized.status).toBe("accepted");
      const [first] = await alice.run(query, { type: "complete" });
      const [second] = await bob.run(query, { type: "complete" });

      if (!first?.textState || !second?.textState)
        throw new Error("Sync text initialization must provide shared state");

      const firstEditor = createSyncTextDocument({ state: first.textState, canEdit: () => true });
      const secondEditor = createSyncTextDocument({ state: second.textState, canEdit: () => true });

      try {
        const firstEdit = firstEditor.edit({ index: 0, deleteCount: 0, insert: "Alice: " });
        const secondEdit = secondEditor.edit({
          index: second.content.length,
          deleteCount: 0,
          insert: " with Bob",
        });
        const operations = [firstEdit, secondEdit].map((change) =>
          sharedTextOperations.edit.create({
            authority: stack.authority,
            workspaceIdentifier: original.workspaceIdentifier,
            arguments: { recordIdentifier: original.id, update: change.update },
          }),
        );
        const clients = [alice, bob];
        const outcomes = await Promise.all(
          operations.map((operation, index) =>
            submitSyncOperation({
              operation,
              submit: (request) =>
                clients[index]!.mutate(sharedWorkspaceMutators.text.edit(request)),
            }),
          ),
        );

        expect(outcomes.map((outcome) => outcome.status)).toEqual(["accepted", "accepted"]);
        const view = bob.materialize(query);
        const converged = Promise.withResolvers<void>();
        const unsubscribe = view.addListener((records) => {
          if (
            records[0]?.content === "Alice: Shared workspace with Bob" &&
            records[0].textRevision === 2
          )
            converged.resolve();
        });
        let accepted: (typeof view.data)[number] | undefined;

        try {
          await waitForTestSyncState(converged.promise, "both accepted text edits on the replica");
          accepted = structuredClone(view.data[0]);
        } finally {
          unsubscribe();
          view.destroy();
        }

        expect(accepted?.content).toBe("Alice: Shared workspace with Bob");
        expect(accepted?.textRevision).toBe(2);
        await stack.restartAuthority();
        const recovered = createSharedRecordClient({
          ...stack,
          storageKey: `${stack.storageKey}-recovered`,
        });

        try {
          const [record] = await recovered.run(query, { type: "complete" });

          expect(record?.content).toBe("Alice: Shared workspace with Bob");
          expect(record?.textState).toBe(accepted?.textState);

          if (!record?.textState) throw new Error("Recovered text state is missing");

          expect(readSyncTextState(record.textState).text).toBe("Alice: Shared workspace with Bob");
          const history = await recovered.run(
            sharedWorkspaceQueries.textHistory({
              workspaceIdentifier: original.workspaceIdentifier,
              recordIdentifier: original.id,
            }),
            { type: "complete" },
          );

          expect(history.map((revision) => revision.revision)).toEqual([2, 1, 0]);
          expect(history[0]?.content).toBe("Alice: Shared workspace with Bob");
          expect(history[2]?.content).toBe("Shared workspace");
          expect(history.map((revision) => revision.parentIdentifier)).toEqual([
            ...history.slice(1).map((revision) => revision.id),
            null,
          ]);
          expect(
            history
              .slice(0, 2)
              .map((revision) => revision.actorIdentifier)
              .toSorted(),
          ).toEqual([stack.userID, stack.collaborator.userID].toSorted());
          expect(
            history
              .slice(0, 2)
              .map((revision) => revision.id)
              .toSorted(),
          ).toEqual(operations.map((operation) => operation.operationIdentifier).toSorted());
        } finally {
          await recovered.close();
        }
      } finally {
        firstEditor.close();
        secondEditor.close();
      }
    } finally {
      await alice.close();
      await bob.close();
      await stack.close();
    }
  },
  120000,
);
