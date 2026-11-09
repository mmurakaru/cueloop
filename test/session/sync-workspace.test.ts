import { expect, test } from "bun:test";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { createTestSyncStack } from "../helpers/sync-stack";
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
    const client = createSharedRecordClient(stack);
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
      await verifyTestBrowserSync(stack);
      view.destroy();
      viewOpen = false;
      await client.close();
      const reconnected = createSharedRecordClient(stack);

      try {
        expect(
          (await reconnected.run(sharedRecordQueries.records(), { type: "complete" }))[0]?.content,
        ).toBe("Written by the browser client");
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
          await stack.close();
        }
      }
    }
  },
  120000,
);
