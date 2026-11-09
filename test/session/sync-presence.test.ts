import { withTestSyncBrowser } from "../helpers/sync-browser";
import * as v from "valibot";
import { expect, test } from "bun:test";
import { join } from "node:path";
import postgres from "postgres";
import { createSyncSqliteStorage } from "@cueloop/sync/storage";
import { resolveSyncTextPosition } from "@cueloop/sync/text";
import { createSharedRecordClient } from "../../examples/sync-workspace/client.ts";
import { sharedRecordQueries } from "../../examples/sync-workspace/shared-record.ts";
import { sharedWorkspaceQueries } from "../../examples/sync-workspace/shared-workspace.ts";
import { createSharedTextEditorSession } from "../../examples/sync-workspace/text-editor-client.ts";
import { createTestSyncStack } from "../helpers/sync-stack";
import { waitForTestTextEditor } from "../helpers/sync-text-editor";

test.skipIf(process.env.CUELOOP_RUN_SYNC !== "1")(
  "authorized editors exchange ephemeral typing and selections without adding saved revisions",
  async () => {
    const stack = await createTestSyncStack({ collaborator: true });
    const reader = createSharedRecordClient(stack);
    const database = postgres(stack.environment.SYNC_DATABASE_URL);
    let first: Awaited<ReturnType<typeof createSharedTextEditorSession>> | undefined;
    let second: typeof first;

    try {
      const [record] = await reader.run(sharedRecordQueries.records(), { type: "complete" });

      if (!record || !stack.collaborator)
        throw new Error("Sync presence test requires its record and collaborator");

      const request = {
        workspaceIdentifier: record.workspaceIdentifier,
        recordIdentifier: record.id,
      };

      first = await createSharedTextEditorSession({
        ...stack,
        ...request,
        storage: createSyncSqliteStorage({ directory: join(stack.directory, "first-presence") }),
      });
      second = await createSharedTextEditorSession({
        ...stack,
        ...stack.collaborator,
        ...request,
        storage: createSyncSqliteStorage({ directory: join(stack.directory, "second-presence") }),
      });
      await Promise.all([
        waitForTestTextEditor(
          first,
          (snapshot) => snapshot.connection === "connected",
          "the first presence connection",
        ),
        waitForTestTextEditor(
          second,
          (snapshot) => snapshot.connection === "connected",
          "the second presence connection",
        ),
      ]);
      const environment = { ...stack.environment, SYNC_CACHE_URL: "" };

      const node = Bun.spawn(
        [
          "node",
          "packages/sync/bin/cueloop-sync.js",
          "connect",
          "--application",
          "examples/sync-workspace/authority.ts",
          "--presence",
          "--workspace",
          record.workspaceIdentifier,
        ],
        { env: environment, stdout: "pipe", stderr: "pipe", signal: AbortSignal.timeout(30000) },
      );
      const output = await new Response(node.stdout).text();

      expect(await node.exited).toBe(0);
      const inspected = v.parse(
        v.object({
          status: v.literal("connected"),
          peers: v.array(v.object({ actorIdentifier: v.string() })),
        }),
        JSON.parse(output),
      );

      expect(
        inspected.peers.some((peer) => peer.actorIdentifier === stack.collaborator?.userID),
      ).toBe(true);
      await withTestSyncBrowser(
        async (page, moduleUrl) => {
          const result: unknown = await page.evaluate(
            async (configuration) => {
              const module: typeof import("../fixtures/sync-browser-presence.ts") = await import(
                configuration.moduleUrl
              );

              return module.inspectBrowserPresence(configuration);
            },
            {
              moduleUrl,
              authorityURL: new URL(moduleUrl).origin,
              workspaceIdentifier: record.workspaceIdentifier,
              auth: stack.auth,
            },
          );
          const snapshot = v.parse(
            v.object({
              status: v.literal("connected"),
              peers: v.array(v.object({ actorIdentifier: v.string() })),
            }),
            result,
          );

          expect(
            snapshot.peers.some((peer) => peer.actorIdentifier === stack.collaborator?.userID),
          ).toBe(true);
        },
        "test/fixtures/sync-browser-presence.ts",
        (incoming) =>
          fetch(new Request(new URL(new URL(incoming.url).pathname, stack.authorityURL), incoming)),
      );
      first.select?.({ anchor: 0, focus: 6 });
      await waitForTestTextEditor(
        second,
        (snapshot) =>
          snapshot.presence?.peers.some(
            (peer) => peer.actorIdentifier === stack.userID && peer.selection !== null,
          ) === true,
        "the remote selection",
      );
      const selection = second
        .getSnapshot()
        .presence?.peers.find((peer) => peer.actorIdentifier === stack.userID)?.selection;

      if (!selection) throw new Error("Sync presence selection was not delivered");

      expect(
        resolveSyncTextPosition({
          state: second.getSnapshot().textState,
          position: selection.focus,
        }),
      ).toBe(6);
      second.change("Team: Shared workspace");
      expect((await second.save()).status).toBe("accepted");
      await waitForTestTextEditor(
        first,
        (snapshot) => snapshot.text === "Team: Shared workspace",
        "the accepted text insertion",
      );
      expect(
        resolveSyncTextPosition({
          state: first.getSnapshot().textState,
          position: selection.focus,
        }),
      ).toBe(12);
      first.change("Team: Shared workspace draft");
      await waitForTestTextEditor(
        second,
        (snapshot) =>
          snapshot.presence?.peers.some(
            (peer) => peer.actorIdentifier === stack.userID && peer.typing,
          ) === true,
        "the remote typing activity",
      );
      expect(second.getSnapshot().text).toBe("Team: Shared workspace");
      const history = await reader.run(sharedWorkspaceQueries.textHistory(request), {
        type: "complete",
      });

      expect(history.map((revision) => revision.revision)).toEqual([1, 0]);
      await database`UPDATE sync_workspace_member SET deleted_at = clock_timestamp() WHERE workspace_identifier = ${record.workspaceIdentifier} AND user_identifier = ${stack.userID}`;
      await waitForTestTextEditor(
        second,
        (snapshot) =>
          snapshot.presence?.status === "connected" &&
          snapshot.presence.peers.every((peer) => peer.actorIdentifier !== stack.userID),
        "revoked presence to disappear",
      );
      await waitForTestTextEditor(
        first,
        (snapshot) => snapshot.presence?.status === "forbidden",
        "revoked presence delivery to stop",
      );
      expect(first.getSnapshot().presence?.peers).toEqual([]);
    } finally {
      await first?.close();
      await second?.close();
      await reader.close();
      await database.end();
      await stack.close();
    }
  },
  120000,
);
