import { expect, test } from "bun:test";
import { createTestSyncStack } from "../helpers/sync-stack";
import { createSharedRecordClient } from "../../examples/sync-workspace/client.ts";
import {
  sharedRecordQueries,
  sharedRecordMutators,
} from "../../examples/sync-workspace/shared-record.ts";
import { createTestSyncProxy } from "../helpers/sync-proxy";
import { createSyncSqliteStorage } from "@cueloop/sync/storage";
import { createSyncDraftStore, SyncDraftRecordSchema } from "@cueloop/sync/drafts";
import { join } from "node:path";
import { writeFileSync } from "node:fs";
import * as v from "valibot";
import postgres from "postgres";
import { createSyncQuerySubscription } from "@cueloop/sync/queries";

test.skipIf(process.env.CUELOOP_RUN_SYNC !== "1")(
  "a slow query consumer receives the latest snapshot and recovers after a byte-budget overflow",
  async () => {
    const stack = await createTestSyncStack();
    const observer = createSharedRecordClient(stack);
    const writer = createSharedRecordClient(stack);
    const query = sharedRecordQueries.records();
    const view = observer.materialize(query);
    const subscription = createSyncQuerySubscription({
      client: observer,
      view,
      maximumBytes: 1024,
      signal: AbortSignal.timeout(60000),
    });
    const iterator = subscription[Symbol.asyncIterator]();

    try {
      const [record] = await writer.run(query, { type: "complete" });

      if (!record) throw new Error("Sync recovery test requires its seeded record");

      const observed = Promise.withResolvers<void>();
      const unsubscribe = view.addListener((records) => {
        if (records[0]?.content === "Final update") observed.resolve();
      });

      try {
        for (const content of ["First update", "Second update", "Final update"]) {
          const result = await writer.mutate(
            sharedRecordMutators.edit({ authority: stack.authority, id: record.id, content }),
          ).server;

          expect(result.type).toBe("success");
        }

        await observed.promise;
        const latest = await iterator.next();

        expect(latest.done).toBe(false);
        expect(latest.value).toMatchObject({
          data: [{ content: "Final update" }],
          connection: "connected",
          lifecycle: { status: "active" },
        });
      } finally {
        unsubscribe();
      }

      const overflowed = Promise.allSettled([iterator.next()]);
      const oversized = await writer.mutate(
        sharedRecordMutators.edit({
          authority: stack.authority,
          id: record.id,
          content: "x".repeat(3000),
        }),
      ).server;

      expect(oversized.type).toBe("success");
      expect(await overflowed).toEqual([
        {
          status: "rejected",
          reason: expect.objectContaining({
            message: expect.stringContaining("Sync query snapshot exceeds its byte budget"),
          }),
        },
      ]);
      const recovered = createSyncQuerySubscription({
        client: observer,
        view: observer.materialize(query),
        maximumBytes: 8192,
        signal: AbortSignal.timeout(30000),
      });
      const recoveryIterator = recovered[Symbol.asyncIterator]();

      try {
        for (;;) {
          const result = await recoveryIterator.next();

          if (result.done)
            throw new Error("Sync recovery subscription closed before receiving its snapshot");

          const snapshot = result.value;

          if (snapshot.freshness === "complete" && snapshot.data[0]?.content === "x".repeat(3000)) {
            expect(snapshot.data[0].content.length).toBe(3000);
            break;
          }
        }
      } finally {
        recovered.close();
      }

      expect((await recoveryIterator.next()).done).toBe(true);
      const active = createSyncQuerySubscription({
        client: observer,
        view: observer.materialize(query),
      });

      await active.next();
      const shuttingDown = observer.close();

      expect(() =>
        observer.mutate(
          sharedRecordMutators.edit({
            authority: stack.authority,
            id: record.id,
            content: "A write after shutdown started",
          }),
        ),
      ).toThrow("retain the change as a draft");
      await shuttingDown;
      expect(active.signal.aborted).toBe(true);
      expect((await active.next()).done).toBe(true);
    } finally {
      subscription.close();
      await observer.close();
      await writer.close();
      await stack.close();
    }
  },
  120000,
);

test.skipIf(process.env.CUELOOP_RUN_SYNC !== "1")(
  "persistent terminal clients recover updates and deletions while offline drafts stay unsent",
  async () => {
    const stack = await createTestSyncStack();
    const proxy = await createTestSyncProxy(stack.cacheURL);
    const storage = createSyncSqliteStorage({ directory: join(stack.directory, "client-cache") });
    const options = { ...stack, cacheURL: proxy.cacheURL, storage };
    const original = createSharedRecordClient(options);
    const writer = createSharedRecordClient(stack);
    const database = postgres(stack.environment.SYNC_DATABASE_URL);
    const drafts = createSyncDraftStore({
      storage,
      authorityIdentifier: stack.authorityURL,
      userIdentifier: stack.userID,
    });
    let recovered: ReturnType<typeof createSharedRecordClient> | undefined;

    try {
      const query = sharedRecordQueries.records();
      const [record] = await original.run(query, { type: "complete" });

      if (!record) throw new Error("Sync persistent recovery test requires its seeded record");

      const disconnected = Promise.withResolvers<void>();
      const unsubscribe = original.connection.state.subscribe((state) => {
        if (state.name !== "connected") disconnected.resolve();
      });

      try {
        proxy.disconnect();
        await disconnected.promise;
        expect((await original.run(query))[0]?.content).toBe("Shared workspace");
        expect(() =>
          original.mutate(
            sharedRecordMutators.edit({
              authority: stack.authority,
              id: record.id,
              content: "Unsent draft",
            }),
          ),
        ).toThrow("retain the change as a draft");
        const saved = await drafts.save({ content: { body: "Unsent draft" } });

        await writer.run(query, { type: "complete" });
        expect(
          (
            await writer.mutate(
              sharedRecordMutators.edit({
                authority: stack.authority,
                id: record.id,
                content: "Changed while disconnected",
              }),
            ).server
          ).type,
        ).toBe("success");
        await original.close();
        proxy.reconnect();
        recovered = createSharedRecordClient(options);
        expect((await recovered.run(query, { type: "complete" }))[0]?.content).toBe(
          "Changed while disconnected",
        );
        await recovered.close();
        recovered = undefined;
        await database`UPDATE shared_record SET deleted_at = clock_timestamp() WHERE id = ${record.id}`;
        recovered = createSharedRecordClient(options);
        expect(await recovered.run(query, { type: "complete" })).toEqual([]);
        expect(await drafts.list()).toEqual([saved]);
        const configuration = join(stack.directory, "experimental.toml");

        writeFileSync(configuration, "[experimental]\nsync = true\n");

        for (const command of [
          ["node", "packages/sync/bin/cueloop-sync.js"],
          [process.execPath, "packages/cli/src/main.ts", "sync"],
        ]) {
          const child = Bun.spawn(
            [
              ...command,
              "connect",
              "--application",
              "examples/sync-workspace/authority.ts",
              "--drafts",
            ],
            {
              env: {
                ...stack.environment,
                SYNC_STORAGE_DIRECTORY: join(stack.directory, "client-cache"),
                CUELOOP_CONFIG: configuration,
              },
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
          expect(v.parse(v.array(SyncDraftRecordSchema), JSON.parse(output))).toEqual([saved]);
        }
      } finally {
        unsubscribe();
      }
    } finally {
      await original.close();
      await recovered?.close();
      await writer.close();
      await drafts.close();
      await database.end();
      await proxy.close();
      await stack.close();
    }
  },
  120000,
);
