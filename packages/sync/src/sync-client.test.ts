import { expect, test } from "bun:test";
import {
  createBuilder,
  createSchema,
  defineMutatorsWithType,
  defineMutatorWithType,
  string,
  table,
} from "@rocicorp/zero";
import * as v from "valibot";
import { createSyncClient } from "./sync-client.ts";

const schema = createSchema({
  tables: [table("shared_record").columns({ id: string(), content: string() }).primaryKey("id")],
});

test("a disconnected mutation stays outside the local replica and is not queued", async () => {
  const mutators = defineMutatorsWithType<typeof schema>()({
    create: defineMutatorWithType<typeof schema>()(
      v.object({ id: v.string(), content: v.string() }),
      async ({ tx, args }) => {
        await tx.mutate.shared_record.insert(args);
      },
    ),
  });
  const client = createSyncClient({ schema, mutators, cacheURL: null, kvStore: "mem" });

  try {
    expect(() =>
      client.mutate(
        mutators.create({ id: "019a0000-0000-7000-8000-000000000001", content: "Draft" }),
      ),
    ).toThrow("requires a connected authority");
    expect(await client.run(createBuilder(schema).shared_record)).toEqual([]);
  } finally {
    await client.close();
  }
});

test("a disconnected sync client reads its cache and closes without an authority", async () => {
  const client = createSyncClient({ schema, cacheURL: null, userID: "reader", kvStore: "mem" });

  try {
    expect(await client.run(createBuilder(schema).shared_record)).toEqual([]);
    expect(client.connection.state.current.name).toBe("disconnected");
  } finally {
    await client.close();
  }
});

test("a Node consumer can close a newly created client without keeping its process alive", async () => {
  const source = `
    import {createSchema, table, string} from '@rocicorp/zero';
    import {createSyncClient} from '@cueloop/sync';
    const schema = createSchema({tables: [table('shared_record').columns({id: string()}).primaryKey('id')]});
    const client = createSyncClient({schema, cacheURL: null, kvStore: 'mem'});
    await client.close();
  `;
  const child = Bun.spawn(["node", "--input-type=module", "-e", source], {
    cwd: new URL("..", import.meta.url).pathname,
    stdout: "pipe",
    stderr: "pipe",
    signal: AbortSignal.timeout(5000),
  });

  expect(await child.exited).toBe(0);
}, 10000);
