import { expect, test } from "bun:test";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import postgres from "postgres";
import * as v from "valibot";
import { createSyncClient } from "@cueloop/sync";
import { defineMutatorsWithType, defineMutatorWithType } from "@cueloop/sync/schema";
import { createTestSyncStack } from "../helpers/sync-stack";
import { verifyTestBrowserQuery } from "../helpers/sync-browser";
import { createSharedRecordClient } from "../../examples/sync-workspace/client.ts";
import {
  sharedRecordMutators,
  sharedRecordQueries,
  sharedRecordSchema,
  type SharedRecordContext,
} from "../../examples/sync-workspace/shared-record.ts";

const uncheckedMutators = defineMutatorsWithType<typeof sharedRecordSchema>()({
  edit: defineMutatorWithType<typeof sharedRecordSchema, SharedRecordContext>()(
    v.object({ id: v.string(), content: v.string() }),
    async () => {},
  ),
});

test.skipIf(process.env.CUELOOP_RUN_SYNC !== "1")(
  "an authenticated client cannot read a workspace without membership",
  async () => {
    const stack = await createTestSyncStack();
    const client = createSharedRecordClient(stack);
    const database = postgres(stack.environment.SYNC_DATABASE_URL);

    try {
      const workspaceIdentifier = "019a6650-0000-7000-8000-000000000099";

      await database`INSERT INTO sync_workspace (id, title) VALUES (${workspaceIdentifier}, 'Private workspace')`;
      await database`INSERT INTO shared_record (workspace_identifier, content) VALUES (${workspaceIdentifier}, 'Private content')`;
      const records = await client.run(
        sharedRecordQueries.records({
          workspaceIdentifier,
          pageSize: 2,
        }),
        { type: "complete" },
      );

      expect(records).toEqual([]);
      const authorized = await client.run(sharedRecordQueries.records(), { type: "complete" });

      expect(authorized.map((record) => record.content)).toEqual(["Shared workspace"]);
      expect(authorized[0]?.workspace?.title).toBe("Shared workspace");
      const authorizedWorkspaceIdentifier = authorized[0]!.workspaceIdentifier;

      await database`INSERT INTO shared_record (workspace_identifier, content, created_at) SELECT ${authorizedWorkspaceIdentifier}, 'Unrequested record ' || sequence, '2020-01-01T00:00:00Z'::timestamptz FROM generate_series(1, 20) AS sequence`;
      await database`INSERT INTO sync_workspace_member (workspace_identifier, user_identifier, role) VALUES (${authorizedWorkspaceIdentifier}, 'private-other-member', 'viewer')`;
      await verifyTestBrowserQuery({
        authority: stack.authority,
        cacheURL: stack.cacheURL,
        userID: stack.userID,
        auth: stack.auth,
        storageKey: stack.storageKey,
        workspaceIdentifier: authorizedWorkspaceIdentifier,
        expectedContent: ["Shared workspace"],
        forbiddenContent: ["Private content", "Unrequested record", "private-other-member"],
      });
      const configuration = join(stack.directory, "experimental.toml");

      writeFileSync(configuration, "[experimental]\nsync = true\n");

      for (const [workspace, expected] of [
        [workspaceIdentifier, []],
        [authorizedWorkspaceIdentifier, ["Shared workspace"]],
      ] as const) {
        const child = Bun.spawn(
          [
            process.execPath,
            "packages/cli/src/main.ts",
            "sync",
            "connect",
            "--application",
            "examples/sync-workspace/authority.ts",
            "--workspace",
            workspace,
            "--limit",
            "1",
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
        ).toBe(0);
        const records = v.parse(v.array(v.object({ content: v.string() })), JSON.parse(output));

        expect(records.map((record) => record.content)).toEqual([...expected]);
      }
    } finally {
      try {
        await client.close();
      } finally {
        try {
          await database.end();
        } finally {
          await stack.close();
        }
      }
    }
  },
  120000,
);

test.skipIf(process.env.CUELOOP_RUN_SYNC !== "1")(
  "revoking membership removes an open subscription and rejects subsequent writes and recovery",
  async () => {
    const stack = await createTestSyncStack();
    const database = postgres(stack.environment.SYNC_DATABASE_URL);
    const client = createSharedRecordClient(stack);
    const view = client.materialize(sharedRecordQueries.records());
    let watcher: Bun.Subprocess<"ignore", "pipe", "pipe"> | undefined;
    const revoked = Promise.withResolvers<void>();
    let initialObserved = false;
    const unsubscribe = view.addListener((records) => {
      if (records.some((record) => record.content === "Shared workspace")) initialObserved = true;

      if (initialObserved && records.length === 0) revoked.resolve();
    });

    try {
      const initial = await client.run(sharedRecordQueries.records(), { type: "complete" });
      const record = initial[0]!;
      const configuration = join(stack.directory, "experimental.toml");

      writeFileSync(configuration, "[experimental]\nsync = true\n");
      watcher = Bun.spawn(
        [
          process.execPath,
          "packages/cli/src/main.ts",
          "sync",
          "connect",
          "--application",
          "examples/sync-workspace/authority.ts",
          "--watch",
          "--workspace",
          record.workspaceIdentifier,
          "--limit",
          "1",
        ],
        {
          env: { ...stack.environment, CUELOOP_CONFIG: configuration },
          stdin: "ignore",
          stdout: "pipe",
          stderr: "pipe",
          signal: AbortSignal.timeout(30000),
        },
      );
      const reader = watcher.stdout.getReader();
      const decoder = new TextDecoder();
      let buffered = "";
      const waitForTestWatch = async (expected: string[]) => {
        for (;;) {
          const newline = buffered.indexOf("\n");

          if (newline >= 0) {
            const line = buffered.slice(0, newline);

            buffered = buffered.slice(newline + 1);
            const snapshot = v.parse(
              v.object({
                records: v.array(v.object({ content: v.string() })),
                freshness: v.picklist(["unknown", "cached", "complete", "error"]),
              }),
              JSON.parse(line),
            );

            if (
              snapshot.freshness === "complete" &&
              snapshot.records.length === expected.length &&
              snapshot.records.every((value, index) => value.content === expected[index])
            )
              return;

            continue;
          }

          const { value, done } = await reader.read();

          if (done) throw new Error("Sync watcher closed before the expected snapshot");

          buffered += decoder.decode(value, { stream: true });
        }
      };

      await waitForTestWatch(["Shared workspace"]);

      await database`UPDATE sync_workspace_member SET deleted_at = now() WHERE user_identifier = ${stack.userID}`;
      await Promise.all([revoked.promise, waitForTestWatch([])]);
      expect(watcher.exitCode).toBeNull();
      watcher.kill("SIGTERM");
      expect(await watcher.exited).toBe(143);
      reader.releaseLock();
      const rejected = await client.mutate(
        sharedRecordMutators.edit({
          authority: stack.authority,
          id: record.id,
          content: "Forbidden edit",
        }),
      ).server;

      expect(rejected.type).toBe("error");
      const uncheckedClient = createSyncClient({
        cacheURL: stack.cacheURL,
        userID: stack.userID,
        auth: stack.auth,
        storageKey: `${stack.storageKey}-unchecked`,
        schema: sharedRecordSchema,
        mutators: uncheckedMutators,
        context: { userIdentifier: "forged-owner" },
        kvStore: "mem",
      });

      try {
        await uncheckedClient.run(sharedRecordQueries.records(), { type: "complete" });
        const forged = uncheckedClient.mutate(
          uncheckedMutators.edit({ id: record.id, content: "Forged edit" }),
        );

        expect((await forged.client).type).toBe("success");
        expect(await forged.server).toMatchObject({
          type: "error",
          error: { type: "app", message: "Shared record editing is not permitted" },
        });
      } finally {
        await uncheckedClient.close();
      }

      await database`UPDATE shared_record SET content = 'Hidden after revocation' WHERE id = ${record.id}`;
      const recovered = createSharedRecordClient(stack);

      try {
        expect(await recovered.run(sharedRecordQueries.records(), { type: "complete" })).toEqual(
          [],
        );
      } finally {
        await recovered.close();
      }

      expect(await client.run(sharedRecordQueries.records())).toEqual([]);
    } finally {
      watcher?.kill("SIGTERM");
      await watcher?.exited;
      unsubscribe();
      view.destroy();
      try {
        await client.close();
      } finally {
        try {
          await database.end();
        } finally {
          await stack.close();
        }
      }
    }
  },
  120000,
);

test.skipIf(process.env.CUELOOP_RUN_SYNC !== "1")(
  "bounded ordered pages track insertion, deletion, and sort changes with stable cursors",
  async () => {
    const stack = await createTestSyncStack();
    const database = postgres(stack.environment.SYNC_DATABASE_URL);
    const client = createSharedRecordClient(stack);
    const firstIdentifier = "019a6650-0000-7000-8000-000000000001";
    const secondIdentifier = "019a6650-0000-7000-8000-000000000002";
    const thirdIdentifier = "019a6650-0000-7000-8000-000000000003";
    const fourthIdentifier = "019a6650-0000-7000-8000-000000000004";

    try {
      const initial = await client.run(sharedRecordQueries.records(), { type: "complete" });
      const workspaceIdentifier = initial[0]!.workspaceIdentifier;

      await database.begin(async (transaction) => {
        await transaction`UPDATE shared_record SET deleted_at = now()`;
        await transaction`INSERT INTO shared_record (id, workspace_identifier, content, created_at) VALUES
          (${firstIdentifier}, ${workspaceIdentifier}, 'First', '2026-01-01T00:00:00Z'),
          (${secondIdentifier}, ${workspaceIdentifier}, 'Second', '2026-01-01T00:00:00Z'),
          (${thirdIdentifier}, ${workspaceIdentifier}, 'Third', '2026-01-01T00:00:00Z')`;
      });
      const pageQuery = sharedRecordQueries.records({ workspaceIdentifier, pageSize: 2 });
      const page = client.materialize(pageQuery);
      const waitForTestPage = (expected: string[]) => {
        const observed = Promise.withResolvers<void>();
        const stop = page.addListener((records) => {
          if (
            records.length === expected.length &&
            records.every((record, index) => record.content === expected[index])
          )
            observed.resolve();
        });

        return observed.promise.finally(stop);
      };

      try {
        await waitForTestPage(["First", "Second"]);
        const first = await client.run(pageQuery);
        const cursor = first[1]!;
        const secondPage = await client.run(
          sharedRecordQueries.records({
            workspaceIdentifier,
            pageSize: 2,
            cursor: { createdAt: cursor.createdAt, id: cursor.id },
          }),
          { type: "complete" },
        );

        expect(secondPage.map((record) => record.content)).toEqual(["Third"]);
        const reordered = waitForTestPage(["Third", "First"]);

        await database`UPDATE shared_record SET created_at = '2026-01-02T00:00:00Z' WHERE id = ${thirdIdentifier}`;
        await reordered;
        const removed = waitForTestPage(["Third", "Second"]);

        await database`UPDATE shared_record SET deleted_at = now() WHERE id = ${firstIdentifier}`;
        await removed;
        const inserted = waitForTestPage(["Newest", "Third"]);

        await database`INSERT INTO shared_record (id, workspace_identifier, content, created_at) VALUES (${fourthIdentifier}, ${workspaceIdentifier}, 'Newest', '2026-01-03T00:00:00Z')`;
        await inserted;
        expect((await client.run(pageQuery)).map((record) => record.content)).toEqual([
          "Newest",
          "Third",
        ]);
        expect(
          (
            await client.run(
              sharedRecordQueries.records({
                workspaceIdentifier,
                pageSize: 2,
                cursor: { createdAt: cursor.createdAt, id: cursor.id },
              }),
              { type: "complete" },
            )
          ).map((record) => record.content),
        ).toEqual([]);
      } finally {
        page.destroy();
      }
    } finally {
      try {
        await client.close();
      } finally {
        try {
          await database.end();
        } finally {
          await stack.close();
        }
      }
    }
  },
  120000,
);
