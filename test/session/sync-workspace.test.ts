import { expect, test } from "bun:test";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { createTestSyncStack } from "../helpers/sync-stack";
import { createTestSyncProxy } from "../helpers/sync-proxy";
import { verifyTestBrowserSync } from "../helpers/sync-browser";
import { createSharedRecordClient } from "../../examples/sync-workspace/client.ts";
import {
  sharedRecordMutators,
  sharedRecordQueries,
} from "../../examples/sync-workspace/shared-record.ts";

test.skipIf(process.env.CUELOOP_RUN_SYNC !== "1")(
  "standalone Bun, Node, and experimental cueloop clients share authoritative records",
  async () => {
    const stack = await createTestSyncStack();
    const proxy = await createTestSyncProxy(stack.cacheURL);
    const client = createSharedRecordClient({ ...stack, cacheURL: proxy.cacheURL });
    const view = client.materialize(sharedRecordQueries.records());
    let viewOpen = true;
    const received = new Promise<void>((resolve) => {
      view.addListener((records) => {
        if (records[0]?.content === "Written by the Node client") resolve();
      });
    });

    try {
      const initial = await client.run(sharedRecordQueries.records(), { type: "complete" });

      expect(initial[0]?.content).toBe("Shared workspace");
      const node = Bun.spawn(
        [
          "node",
          "packages/sync/bin/cueloop-sync.js",
          "connect",
          "--application",
          "examples/sync-workspace/authority.ts",
          "--content",
          "Written by the Node client",
        ],
        {
          env: stack.environment,
          stdout: "pipe",
          stderr: "pipe",
          signal: AbortSignal.timeout(30000),
        },
      );
      const nodeOutput = await new Response(node.stdout).text();

      expect(await node.exited).toBe(0);
      expect(nodeOutput).toContain("Written by the Node client");
      await received;
      const configuration = join(stack.directory, "config.toml");

      writeFileSync(configuration, "[experimental]\nsync = true\n");
      const cueloop = Bun.spawn(
        [
          process.execPath,
          "packages/cli/src/main.ts",
          "sync",
          "connect",
          "--application",
          "examples/sync-workspace/authority.ts",
          "--content",
          "Written by cueloop",
        ],
        {
          env: { ...stack.environment, CUELOOP_CONFIG: configuration },
          stdout: "pipe",
          stderr: "pipe",
          signal: AbortSignal.timeout(30000),
        },
      );
      const cueloopOutput = await new Response(cueloop.stdout).text();

      expect(await cueloop.exited).toBe(0);
      expect(cueloopOutput).toContain("Written by cueloop");
      const record = initial[0]!;
      const mutation = await client.mutate(
        sharedRecordMutators.edit({ id: record.id, content: "Written by the Bun SDK" }),
      ).server;

      expect(mutation.type).toBe("success");
      const browserObserved = Promise.withResolvers<void>();
      const stopBrowserObservation = view.addListener((records) => {
        if (records[0]?.content === "Written by the browser client") browserObserved.resolve();
      });

      try {
        await verifyTestBrowserSync(stack);
        await browserObserved.promise;
      } finally {
        stopBrowserObservation();
      }

      const disconnected = Promise.withResolvers<void>();
      const stopConnection = client.connection.state.subscribe((state) => {
        if (state.name !== "connected") disconnected.resolve();
      });
      const recovered = Promise.withResolvers<void>();
      const stopView = view.addListener((records) => {
        if (records[0]?.content === "Written while disconnected") recovered.resolve();
      });

      try {
        proxy.disconnect();
        await disconnected.promise;
        const writer = createSharedRecordClient(stack);

        try {
          await writer.run(sharedRecordQueries.records(), { type: "complete" });
          const result = await writer.mutate(
            sharedRecordMutators.edit({
              id: record.id,
              content: "Written while disconnected",
            }),
          ).server;

          expect(result.type).toBe("success");
          expect((await client.run(sharedRecordQueries.records()))[0]?.content).toBe(
            "Written by the browser client",
          );
        } finally {
          await writer.close();
        }

        proxy.reconnect();
        await recovered.promise;
      } finally {
        stopConnection();
        stopView();
      }

      view.destroy();
      viewOpen = false;
      await client.close();
      const reconnected = createSharedRecordClient(stack);

      try {
        expect(
          (await reconnected.run(sharedRecordQueries.records(), { type: "complete" }))[0]?.content,
        ).toBe("Written while disconnected");
      } finally {
        await reconnected.close();
      }
    } finally {
      try {
        if (viewOpen) view.destroy();
      } finally {
        try {
          await client.close();
        } finally {
          try {
            await proxy.close();
          } finally {
            await stack.close();
          }
        }
      }
    }
  },
  120000,
);
