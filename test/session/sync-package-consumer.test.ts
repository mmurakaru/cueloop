import { expect, test } from "bun:test";
import { writeFile, mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { createTestPackedSyncConsumer } from "../helpers/sync-package-consumer";
import { withTestSyncBrowser } from "../helpers/sync-browser";
import { createTestSyncStack } from "../helpers/sync-stack";
import { createSyncBackup } from "@cueloop/sync/backup";
import { readSyncDatabaseStatus } from "@cueloop/sync/database/status";
import postgres from "postgres";

const consumerSource = `
import {createSyncClient} from '@cueloop/sync';
import {createSchema, createBuilder, table, string} from '@cueloop/sync/schema';
import {createSyncTextState} from '@cueloop/sync/text';
const schema = createSchema({tables: [table('record').columns({id: string()}).primaryKey('id')]});
export async function verifyPackedSync() {
  const client = createSyncClient({schema, cacheURL: null, kvStore: 'mem'});
  try {
    const records = await client.run(createBuilder(schema).record);
    if (records.length !== 0) throw new Error('An empty cache must have no records');
    return {records: records.length, text: createSyncTextState('Installed SDK').text};
  } finally {
    await client.close();
  }
}
`;

test.skipIf(process.env.CUELOOP_RUN_SYNC !== "1")(
  "a clean npm installation exposes every public module and runs Bun, Node, and browser consumers",
  async () => {
    const consumer = await createTestPackedSyncConsumer();

    try {
      const script = join(consumer.directory, "consumer.mjs");
      const entrypoints = Object.entries(consumer.exports)
        .filter(([, target]) => target.endsWith(".js"))
        .map(([subpath]) =>
          subpath === "." ? "@cueloop/sync" : `@cueloop/sync${subpath.slice(1)}`,
        );

      await writeFile(
        script,
        consumerSource +
          `\nfor (const entrypoint of ${JSON.stringify(entrypoints)}) await import(entrypoint);\nconsole.log(JSON.stringify(await verifyPackedSync()));\n`,
      );

      for (const runtime of [process.execPath, "node"])
        expect(await consumer.run([runtime, script])).toContain('"records":0');

      const browserEntry = join(consumer.directory, "browser.mjs");

      await writeFile(browserEntry, consumerSource);
      await withTestSyncBrowser(async (page, moduleURL) => {
        expect(
          await page.evaluate(async (url) => {
            const module = await import(url);

            return module.verifyPackedSync();
          }, moduleURL),
        ).toEqual({ records: 0, text: "Installed SDK" });
      }, browserEntry);
      expect(
        await consumer.run([
          "node",
          join(consumer.directory, "node_modules", ".bin", "cueloop-sync"),
          "--help",
        ]),
      ).toContain("General-purpose sync for terminals");
    } finally {
      await consumer.close();
    }
  },
);

test.skipIf(process.env.CUELOOP_RUN_SYNC !== "1")(
  "a compiled installed SDK initializes and restores PostgreSQL from a clean working directory",
  async () => {
    const stack = await createTestSyncStack();
    const database = postgres(stack.environment.SYNC_DATABASE_URL);
    const consumer = await createTestPackedSyncConsumer();

    try {
      await database.unsafe("CREATE DATABASE sync_compiled_initialize");
      await database.unsafe("CREATE DATABASE sync_compiled_restore");
      const tools = (name: string) => ({
        dump: [
          "docker",
          "exec",
          "-i",
          stack.postgresContainer,
          "env",
          `PGDATABASE=${name}`,
          "PGUSER=sync_test",
          "pg_dump",
        ],
        restore: [
          "docker",
          "exec",
          "-i",
          stack.postgresContainer,
          "env",
          `PGDATABASE=${name}`,
          "PGUSER=sync_test",
          "pg_restore",
        ],
      });
      const archive = await createSyncBackup({
        databaseURL: stack.environment.SYNC_DATABASE_URL,
        directory: join(stack.directory, "compiled-backup"),
        tools: tools("sync_test"),
      });
      const source = join(consumer.directory, "operator.mjs");
      const executable = join(consumer.directory, "sync-operator");
      const empty = join(consumer.directory, "empty");

      await mkdir(empty);
      await writeFile(
        source,
        `
import {initializeSyncDatabase} from '@cueloop/sync/database/initialize';
import {restoreSyncBackup} from '@cueloop/sync/restore';
const databaseURL = process.env.SYNC_OPERATOR_DATABASE;
const result = process.argv[2] === 'initialize' ? await initializeSyncDatabase({databaseURL}) : await restoreSyncBackup({databaseURL, directory: process.env.SYNC_OPERATOR_ARCHIVE, tools: JSON.parse(process.env.SYNC_OPERATOR_TOOLS)});
console.log(JSON.stringify(result));
`,
      );
      await consumer.run([process.execPath, "build", "--compile", source, "--outfile", executable]);
      await rm(join(consumer.directory, "node_modules"), { recursive: true, force: true });
      const initializedURL = new URL(stack.environment.SYNC_DATABASE_URL);
      const restoredURL = new URL(stack.environment.SYNC_DATABASE_URL);

      initializedURL.pathname = "/sync_compiled_initialize";
      restoredURL.pathname = "/sync_compiled_restore";
      expect(
        await consumer.run([executable, "initialize"], {
          cwd: empty,
          environment: { SYNC_OPERATOR_DATABASE: initializedURL.href },
        }),
      ).toContain('"status":"recovering"');
      expect(await readSyncDatabaseStatus(initializedURL.href)).toMatchObject({
        status: "recovering",
        ready: false,
      });
      await consumer.run([executable, "restore"], {
        cwd: empty,
        environment: {
          SYNC_OPERATOR_DATABASE: restoredURL.href,
          SYNC_OPERATOR_ARCHIVE: archive.directory,
          SYNC_OPERATOR_TOOLS: JSON.stringify(tools("sync_compiled_restore")),
        },
      });
      const restored = await readSyncDatabaseStatus(restoredURL.href);

      expect(restored).toMatchObject({
        status: "recovering",
        ready: false,
        authority: { authorityIdentifier: stack.authority.authorityIdentifier },
      });
      expect(restored.authority?.generation).not.toBe(stack.authority.generation);
    } finally {
      await consumer.close();
      await database.end();
      await stack.close();
    }
  },
);
