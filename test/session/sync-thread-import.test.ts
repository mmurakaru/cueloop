import * as v from "valibot";
import { expect, test } from "bun:test";
import { join } from "node:path";
import { DaemonCore } from "@cueloop/daemon/api";
import { createSyncClient } from "@cueloop/sync";
import { createSyncTextDocument } from "@cueloop/sync/text";
import { submitSyncOperation } from "@cueloop/sync/operations";
import { syncThreadSchema } from "@cueloop/daemon/sync-thread-schema";
import { syncThreadQueries } from "@cueloop/daemon/sync-thread-queries";
import { syncThreadMutators } from "@cueloop/daemon/sync-thread-mutators";
import {
  prepareSyncThreadImport,
  prepareSyncThreadCommand,
  syncThreadOperations,
} from "@cueloop/daemon/sync-thread-protocol";
import {
  uploadSyncThreadImport,
  uploadSyncThreadCommand,
  lookupSyncThreadOperation,
} from "@cueloop/daemon/sync-thread-import-client";
import { createTestSyncStack } from "../helpers/sync-stack";

test.skipIf(process.env.CUELOOP_RUN_SYNC !== "1")(
  "Thread import preserves large history and native receipts while collaborators edit across authority restart",
  async () => {
    const stack = await createTestSyncStack({ application: "thread", collaborator: true });
    const local = new DaemonCore(join(stack.directory, "local-owner"));
    const owner = createSyncClient({
      schema: syncThreadSchema,
      mutators: syncThreadMutators,
      cacheURL: stack.cacheURL,
      userID: stack.userID,
      auth: stack.auth,
      kvStore: "mem",
      storageKey: stack.storageKey,
      context: { actorIdentifier: stack.userID },
    });
    let collaborator: typeof owner | undefined;
    let recovered: typeof owner | undefined;

    try {
      const [workspace] = await owner.run(syncThreadQueries.workspaces({ pageSize: 1 }), {
        type: "complete",
      });

      if (!workspace || !stack.collaborator)
        throw new Error("Sync Thread import test requires its workspace and collaborator");

      const source = local.sessionCreate({
        workspace: { repoRoot: stack.directory, branch: "main" },
        artifact: {
          type: "plan",
          content: "Historical plan detail.\n".repeat(18000),
          meta: { title: "Imported review" },
        },
      });

      local.sessionBranch(source.id, "proposal");
      local.sessionSetWorkingCopy(source.id, "Shared reviewed plan");
      local.sessionAnnotate(
        source.id,
        {
          id: "preserved-comment",
          kind: "comment",
          author: stack.userID,
          anchor: { quote: "Shared", prefix: "", suffix: " reviewed plan" },
          body: "Preserve this decision",
        },
        "Owner",
      );
      local.sessionSendMessage(
        source.id,
        "comment",
        "Previous message",
        undefined,
        "native-before-import",
      );
      const original = structuredClone(local.sessionGet(source.id));
      const upload = await prepareSyncThreadImport({
        authority: stack.authority,
        workspaceIdentifier: workspace.id,
        thread: original,
      });

      expect(Buffer.byteLength(upload.snapshot)).toBeGreaterThan(512 * 1024);
      await uploadSyncThreadImport({
        authorityURL: stack.authorityURL,
        authenticationToken: stack.auth,
        upload,
      });
      const accepted = await submitSyncOperation({
        operation: upload.operation,
        submit: (request) => owner.mutate(syncThreadMutators.thread.import(request)),
        lookup: (request) =>
          lookupSyncThreadOperation({
            authorityURL: stack.authorityURL,
            authenticationToken: stack.auth,
            operation: request,
          }),
      });

      expect(accepted.status).toBe("accepted");
      collaborator = createSyncClient({
        schema: syncThreadSchema,
        mutators: syncThreadMutators,
        cacheURL: stack.cacheURL,
        userID: stack.collaborator.userID,
        auth: stack.collaborator.auth,
        kvStore: "mem",
        context: { actorIdentifier: stack.collaborator.userID },
        storageKey: `${stack.storageKey}-collaborator`,
      });
      const query = syncThreadQueries.document({
        workspaceIdentifier: workspace.id,
        recordIdentifier: upload.operation.arguments.recordIdentifier,
      });
      const document = await collaborator.run(query, { type: "complete" });

      if (!document?.textState || !document.textDocumentIdentifier)
        throw new Error("Imported Thread requires its collaborative document generation");

      expect(document.document).toMatchObject({
        id: original.id,
        history: original.history,
        annotations: original.annotations,
        participants: original.participants,
      });
      expect(document.document).not.toHaveProperty("messageOperations");
      expect(document.document).not.toHaveProperty("shares");
      const ownerQuery = syncThreadQueries.ownerDocument({
        workspaceIdentifier: workspace.id,
        recordIdentifier: upload.operation.arguments.recordIdentifier,
      });

      expect(await collaborator.run(ownerQuery, { type: "complete" })).toBeUndefined();
      expect((await owner.run(ownerQuery, { type: "complete" }))?.document).toEqual(
        JSON.parse(upload.snapshot),
      );
      const editor = createSyncTextDocument({ state: document.textState, canEdit: () => true });
      const change = editor.replace("Collaborator updated plan");

      editor.close();
      const edit = syncThreadOperations.editText.create({
        authority: stack.authority,
        workspaceIdentifier: workspace.id,
        arguments: {
          recordIdentifier: document.id,
          documentIdentifier: document.textDocumentIdentifier,
          update: change.update,
        },
      });
      const edited = await submitSyncOperation({
        operation: edit,
        submit: (request) => collaborator!.mutate(syncThreadMutators.thread.editText(request)),
        lookup: (request) =>
          lookupSyncThreadOperation({
            authorityURL: stack.authorityURL,
            authenticationToken: stack.collaborator!.auth,
            operation: request,
          }),
      });

      expect(edited.status).toBe("accepted");
      await stack.restartAuthority();
      recovered = createSyncClient({
        schema: syncThreadSchema,
        mutators: syncThreadMutators,
        cacheURL: stack.cacheURL,
        userID: stack.userID,
        auth: stack.auth,
        kvStore: "mem",
        context: { actorIdentifier: stack.userID },
        storageKey: `${stack.storageKey}-recovered`,
      });
      const restored = await recovered.run(ownerQuery, { type: "complete" });

      expect(restored?.document).toMatchObject({
        id: original.id,
        workingCopy: "Collaborator updated plan",
        annotations: original.annotations,
        participants: original.participants,
        messageOperations: original.messageOperations,
      });

      if (!restored?.thread) throw new Error("Recovered Thread requires its authoritative version");

      const revision = await prepareSyncThreadCommand({
        workspaceIdentifier: workspace.id,
        recordIdentifier: document.id,
        expectedVersion: restored.thread.version,
        command: {
          method: "session.submitRevision",
          parameters: { id: source.id, content: "Large agent revision.\n".repeat(30000) },
        },
      });

      if (revision.kind !== "staged")
        throw new Error("Large agent revision must use bounded staging");

      await uploadSyncThreadCommand({
        authorityURL: stack.authorityURL,
        authenticationToken: stack.auth,
        upload: revision.upload,
      });
      const revised = await submitSyncOperation({
        operation: revision.operation,
        submit: (operation) =>
          recovered!.mutate(syncThreadMutators.thread.stagedCommand(operation)),
        lookup: (operation) =>
          lookupSyncThreadOperation({
            authorityURL: stack.authorityURL,
            authenticationToken: stack.auth,
            operation,
          }),
      });

      expect(revised.status).toBe("accepted");

      if (revised.status !== "accepted" || revised.result.status !== "retained")
        throw new Error("Agent revision requires its retained acceptance receipt");

      const { version: currentVersion } = v.parse(
        v.object({ version: v.number() }),
        revised.result.value,
      );
      const staleText = syncThreadOperations.editText.create({
        authority: stack.authority,
        workspaceIdentifier: workspace.id,
        arguments: { ...edit.arguments },
      });
      const generationRejected = await submitSyncOperation({
        operation: staleText,
        submit: (operation) => collaborator!.mutate(syncThreadMutators.thread.editText(operation)),
        lookup: (operation) =>
          lookupSyncThreadOperation({
            authorityURL: stack.authorityURL,
            authenticationToken: stack.collaborator!.auth,
            operation,
          }),
      });

      expect(generationRejected).toMatchObject({
        status: "rejected",
        reason: { status: "retained", code: "text_generation_conflict" },
      });
      await uploadSyncThreadImport({
        authorityURL: stack.authorityURL,
        authenticationToken: stack.auth,
        upload,
      });
      const repeatedImport = await submitSyncOperation({
        operation: upload.operation,
        submit: (operation) => recovered!.mutate(syncThreadMutators.thread.import(operation)),
        lookup: (operation) =>
          lookupSyncThreadOperation({
            authorityURL: stack.authorityURL,
            authenticationToken: stack.auth,
            operation,
          }),
      });

      expect(repeatedImport).toEqual(accepted);
      const forbidden = syncThreadOperations.command.create({
        authority: stack.authority,
        workspaceIdentifier: workspace.id,
        arguments: {
          recordIdentifier: document.id,
          expectedVersion: currentVersion,
          method: "session.sendMessage",
          parameters: {
            id: source.id,
            outcome: "approved",
            summary: "Unapproved collaborator message",
          },
        },
      });
      const denied = await submitSyncOperation({
        operation: forbidden,
        submit: (request) => collaborator!.mutate(syncThreadMutators.thread.command(request)),
        lookup: (request) =>
          lookupSyncThreadOperation({
            authorityURL: stack.authorityURL,
            authenticationToken: stack.collaborator!.auth,
            operation: request,
          }),
      });

      expect(denied).toMatchObject({
        status: "rejected",
        reason: { status: "retained", code: "permission_denied" },
      });
      const message = syncThreadOperations.command.create({
        authority: stack.authority,
        workspaceIdentifier: workspace.id,
        arguments: {
          recordIdentifier: document.id,
          expectedVersion: currentVersion,
          method: "session.sendMessage",
          parameters: {
            id: source.id,
            outcome: "approved",
            summary: "Ready",
            operationId: "native-after-import",
          },
        },
      });
      const sent = await submitSyncOperation({
        operation: message,
        submit: (request) => recovered!.mutate(syncThreadMutators.thread.command(request)),
        lookup: (request) =>
          lookupSyncThreadOperation({
            authorityURL: stack.authorityURL,
            authenticationToken: stack.auth,
            operation: request,
          }),
      });

      expect(sent.status).toBe("accepted");
      const finalReader = createSyncClient({
        schema: syncThreadSchema,
        mutators: syncThreadMutators,
        cacheURL: stack.cacheURL,
        userID: stack.userID,
        auth: stack.auth,
        kvStore: "mem",
        context: { actorIdentifier: stack.userID },
        storageKey: `${stack.storageKey}-final`,
      });

      try {
        const final = await finalReader.run(query, { type: "complete" });

        expect(final?.document).toMatchObject({
          status: "resolved",
          message: { outcome: "approved", summary: "Ready" },
        });
      } finally {
        await finalReader.close();
      }
    } finally {
      await recovered?.close();
      await collaborator?.close();
      await owner.close();
      local.dispose();
      await stack.close();
    }
  },
  120000,
);
