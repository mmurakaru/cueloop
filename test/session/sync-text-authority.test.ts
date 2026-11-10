import { expect, test } from "bun:test";
import postgres from "postgres";
import { createTestSyncStack } from "../helpers/sync-stack";
import { waitForTestSyncState } from "../helpers/sync-test-deadline";
import { createSharedRecordClient } from "../../examples/sync-workspace/client.ts";
import {
  sharedRecordQueries,
  sharedRecordMutators,
} from "../../examples/sync-workspace/shared-record.ts";
import {
  sharedWorkspaceQueries,
  sharedWorkspaceMutators,
  sharedTextOperations,
} from "../../examples/sync-workspace/shared-workspace.ts";
import { createSyncTextState, createSyncTextDocument, readSyncTextState } from "@cueloop/sync/text";
import { submitSyncOperation } from "@cueloop/sync/operations";

test.skipIf(process.env.CUELOOP_RUN_SYNC !== "1")(
  "text state, revision history, and receipts remain atomic and reject unauthorized edits",
  async () => {
    const stack = await createTestSyncStack();
    const writer = createSharedRecordClient({ ...stack, storageKey: `${stack.storageKey}-writer` });
    const observer = createSharedRecordClient({
      ...stack,
      storageKey: `${stack.storageKey}-observer`,
    });
    const database = postgres(stack.environment.SYNC_DATABASE_URL);

    try {
      const query = sharedRecordQueries.records();
      const [record] = await writer.run(query, { type: "complete" });

      if (!record) throw new Error("Sync text authority test requires its seeded record");

      const initial = createSyncTextState(record.content);
      const initialized = await submitSyncOperation({
        operation: sharedTextOperations.initialize.create({
          authority: stack.authority,
          workspaceIdentifier: record.workspaceIdentifier,
          arguments: { recordIdentifier: record.id, state: initial.state },
        }),
        submit: (operation) => writer.mutate(sharedWorkspaceMutators.text.initialize(operation)),
      });

      expect(initialized.status).toBe("accepted");
      await observer.run(query, { type: "complete" });
      const view = observer.materialize(query);
      const applied = Promise.withResolvers<void>();
      const observed: string[] = [];
      const unsubscribe = view.addListener((records) => {
        const current = records[0];

        if (current) observed.push(current.content);

        if (current?.content === "Accepted after rollback" && current.textRevision === 1)
          applied.resolve();
      });
      const editor = createSyncTextDocument({ state: initial.state, canEdit: () => true });

      try {
        await database.unsafe(
          "CREATE FUNCTION reject_test_text_revision() RETURNS trigger AS $$ BEGIN IF NEW.revision > 0 THEN RAISE EXCEPTION 'Injected text revision failure'; END IF; RETURN NEW; END; $$ LANGUAGE plpgsql",
        );
        await database.unsafe(
          "CREATE TRIGGER reject_test_text_revision BEFORE INSERT ON shared_text_revision FOR EACH ROW EXECUTE FUNCTION reject_test_text_revision()",
        );
        const changed = editor.replace("Accepted after rollback");
        const operation = sharedTextOperations.edit.create({
          authority: stack.authority,
          workspaceIdentifier: record.workspaceIdentifier,
          arguments: { recordIdentifier: record.id, update: changed.update },
        });
        const failed = await submitSyncOperation({
          operation,
          submit: (request) => writer.mutate(sharedWorkspaceMutators.text.edit(request)),
        });

        expect(failed.status).toBe("pending");
        const response = await fetch(`${stack.authorityURL}/operation`, {
          method: "POST",
          headers: { authorization: `Bearer ${stack.auth}`, "content-type": "application/json" },
          body: JSON.stringify(operation),
          signal: AbortSignal.timeout(30000),
        });

        expect(response.status).toBe(200);
        expect(await response.json()).toEqual({ receipt: null });
        expect((await observer.run(query))[0]?.content).toBe("Shared workspace");
        const historyQuery = sharedWorkspaceQueries.textHistory({
          workspaceIdentifier: record.workspaceIdentifier,
          recordIdentifier: record.id,
        });

        expect(
          (await observer.run(historyQuery, { type: "complete" })).map(
            (revision) => revision.content,
          ),
        ).toEqual(["Shared workspace"]);
        await database.unsafe("DROP TRIGGER reject_test_text_revision ON shared_text_revision");
        const retried = await submitSyncOperation({
          operation,
          submit: (request) => writer.mutate(sharedWorkspaceMutators.text.edit(request)),
        });

        expect(retried.status).toBe("accepted");
        await waitForTestSyncState(
          applied.promise,
          "the text edit after a rolled-back transaction",
        );
        const accepted = view.data[0];

        if (!accepted?.textState) throw new Error("Accepted text state is missing");

        expect(readSyncTextState(accepted.textState).text).toBe("Accepted after rollback");
        await database`UPDATE sync_workspace_member SET role = 'viewer' WHERE workspace_identifier = ${record.workspaceIdentifier} AND user_identifier = ${stack.userID}`;
        const denied = editor.replace("Viewer text must not be accepted");
        const rejected = await submitSyncOperation({
          operation: sharedTextOperations.edit.create({
            authority: stack.authority,
            workspaceIdentifier: record.workspaceIdentifier,
            arguments: { recordIdentifier: record.id, update: denied.update },
          }),
          submit: (request) => writer.mutate(sharedWorkspaceMutators.text.edit(request)),
        });

        expect(rejected).toMatchObject({
          status: "rejected",
          reason: { status: "retained", code: "permission_denied" },
        });
        expect((await observer.run(query))[0]?.content).toBe("Accepted after rollback");
        expect(observed).not.toContain("Viewer text must not be accepted");
        const bypass = await writer.mutate(
          sharedRecordMutators.edit({
            authority: stack.authority,
            id: record.id,
            content: "Bypass collaborative state",
          }),
        ).server;

        expect(bypass.type).toBe("error");
        expect((await observer.run(query))[0]?.content).toBe("Accepted after rollback");
        const history = await observer.run(historyQuery, { type: "complete" });

        expect(history.map((revision) => revision.content)).toEqual([
          "Accepted after rollback",
          "Shared workspace",
        ]);
      } finally {
        unsubscribe();
        view.destroy();
        editor.close();
      }
    } finally {
      await writer.close();
      await observer.close();
      await database.end();
      await stack.close();
    }
  },
  120000,
);
