import { waitForTestSyncState } from "../helpers/sync-test-deadline";
import { createTestSyncStack } from "../helpers/sync-stack";
import { createTestSyncProxy } from "../helpers/sync-proxy";
import { createSharedRecordClient } from "../../examples/sync-workspace/client.ts";
import {
  sharedRecordQueries,
  sharedRecordMutators,
} from "../../examples/sync-workspace/shared-record.ts";
import postgres from "postgres";
import * as v from "valibot";
import { expect, test } from "bun:test";
import { verifyTestBrowserDraftStorage, withTestSyncBrowser } from "../helpers/sync-browser";

test.skipIf(process.env.CUELOOP_RUN_SYNC !== "1")(
  "browser drafts survive a full page reload with IndexedDB storage",
  verifyTestBrowserDraftStorage,
  30000,
);

test.skipIf(process.env.CUELOOP_RUN_SYNC !== "1")(
  "a browser replica reloads offline cached records and catches up with updates and deletions",
  async () => {
    const stack = await createTestSyncStack();
    const proxy = await createTestSyncProxy(stack.cacheURL);
    const writer = createSharedRecordClient(stack);
    const database = postgres(stack.environment.SYNC_DATABASE_URL);

    try {
      await withTestSyncBrowser(async (page, moduleUrl) => {
        const read = async (complete: boolean) => {
          const result: unknown = await waitForTestSyncState(
            page.evaluate(
              async (configuration) => {
                const module: typeof import("../fixtures/sync-browser-replica.ts") = await import(
                  configuration.moduleUrl
                );

                return module.readBrowserReplica(configuration);
              },
              {
                moduleUrl,
                complete,
                cacheURL: proxy.cacheURL,
                userID: stack.userID,
                auth: stack.auth,
                storageKey: `${stack.storageKey}-persistent-browser`,
              },
            ),
            "browser replica query",
          );

          return v.parse(
            v.object({
              records: v.array(v.object({ id: v.string(), content: v.string() })),
              connection: v.string(),
            }),
            result,
          );
        };

        await page.evaluate(
          async (configuration) => {
            const module: typeof import("../fixtures/sync-browser-replica.ts") = await import(
              configuration.moduleUrl
            );

            await module.openBrowserReplica(configuration);
          },
          {
            moduleUrl,
            cacheURL: proxy.cacheURL,
            userID: stack.userID,
            auth: stack.auth,
            storageKey: `${stack.storageKey}-persistent-browser`,
          },
        );
        const initial = await read(true);

        expect(initial.records[0]?.content).toBe("Shared workspace");
        proxy.disconnect();
        await waitForTestSyncState(
          page.evaluate(
            async (configuration) => {
              const module: typeof import("../fixtures/sync-browser-replica.ts") = await import(
                configuration.moduleUrl
              );

              await module.waitForBrowserReplicaData(configuration);
            },
            {
              moduleUrl,
              cacheURL: proxy.cacheURL,
              userID: stack.userID,
              auth: stack.auth,
              storageKey: `${stack.storageKey}-persistent-browser`,
            },
          ),
          "offline replica persistence",
        );
        await page.evaluate(async (moduleUrl) => {
          const module: typeof import("../fixtures/sync-browser-replica.ts") = await import(
            moduleUrl
          );

          await module.closeBrowserReplica();
        }, moduleUrl);
        await page.reload();
        const cached = await read(false);

        expect(cached.records).toEqual(initial.records);
        expect(cached.connection).not.toBe("connected");
        const [record] = await writer.run(sharedRecordQueries.records(), { type: "complete" });

        if (!record) throw new Error("Browser recovery test requires its seeded record");

        expect(
          (
            await writer.mutate(
              sharedRecordMutators.edit({
                id: record.id,
                content: "Updated while browser was offline",
              }),
            ).server
          ).type,
        ).toBe("success");
        proxy.reconnect();
        await page.reload();
        expect((await read(true)).records[0]?.content).toBe("Updated while browser was offline");
        await database`UPDATE shared_record SET deleted_at = clock_timestamp() WHERE id = ${record.id}`;
        await page.reload();
        expect((await read(true)).records).toEqual([]);
      }, "test/fixtures/sync-browser-replica.ts");
    } finally {
      await writer.close();
      await database.end();
      await proxy.close();
      await stack.close();
    }
  },
  120000,
);
