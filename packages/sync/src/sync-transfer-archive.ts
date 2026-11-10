import type postgres from "postgres";
import * as v from "valibot";
import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";
import { open, readFile } from "node:fs/promises";
import { join } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { digestSyncBackupArchive } from "./sync-backup-manifest.ts";
import { SyncTransferManifestSchema, type SyncTransferManifest } from "./sync-transfer-protocol.ts";
import {
  quoteSyncTransferIdentifier,
  readSyncTransferColumns,
  syncTransferTables,
  type SyncWorkspaceTransferAdapter,
} from "./sync-transfer-adapter.ts";

const ArchiveLineSchema = v.variant("kind", [
  v.strictObject({
    kind: v.literal("table"),
    table: v.string(),
    columns: v.array(v.object({ name: v.string(), type: v.string() })),
  }),
  v.strictObject({ kind: v.literal("row"), table: v.string(), row: v.string() }),
]);
const maximumLineBytes = 64 * 1024 * 1024;

export async function readSyncTransferManifest(directory: string) {
  const manifest = v.parse(
    SyncTransferManifestSchema,
    JSON.parse(await readFile(join(directory, "manifest.json"), "utf8")),
  );

  if (
    (await digestSyncBackupArchive(join(directory, "workspace.jsonl"))) !== manifest.archiveDigest
  )
    throw new Error("Sync workspace archive digest does not match its manifest");

  return manifest;
}

export async function exportSyncTransferRows(options: {
  transaction: postgres.TransactionSql;
  directory: string;
  workspaceIdentifier: string;
  adapter: SyncWorkspaceTransferAdapter;
  signal?: AbortSignal;
}) {
  const output = await open(join(options.directory, "workspace.jsonl"), "wx", 0o600);
  let rowCount = 0;
  const write = async (value: v.InferOutput<typeof ArchiveLineSchema>) => {
    const line = `${JSON.stringify(value)}\n`;

    if (Buffer.byteLength(line) > maximumLineBytes)
      throw new Error("Sync transfer row exceeds the 64 MiB archive limit");

    await output.writeFile(line);
  };

  try {
    for (const table of syncTransferTables(options.adapter)) {
      const columns = await readSyncTransferColumns(options.transaction, table);
      const names = columns.map(({ name }) => quoteSyncTransferIdentifier(name)).join(", ");

      await write({ kind: "table", table: table.table, columns });
      const rows = options.transaction.unsafe(
        `SELECT row_to_json(record)::text AS payload FROM (SELECT ${names} FROM public.${quoteSyncTransferIdentifier(table.table)} WHERE ${quoteSyncTransferIdentifier(table.workspaceColumn)} = $1 ORDER BY id) AS record`,
        [options.workspaceIdentifier],
      );

      for await (const batch of rows.cursor(1)) {
        options.signal?.throwIfAborted();
        const [record] = v.parse(v.array(v.object({ payload: v.string() })), batch);

        if (!record) throw new Error("Sync transfer cursor returned an empty row");

        await write({ kind: "row", table: table.table, row: record.payload });
        rowCount += 1;
      }
    }

    await output.sync();

    return rowCount;
  } finally {
    await output.close();
  }
}

export async function importSyncTransferRows(options: {
  transaction: postgres.TransactionSql;
  directory: string;
  manifest: SyncTransferManifest;
  adapter: SyncWorkspaceTransferAdapter;
  signal?: AbortSignal;
}) {
  const tables = syncTransferTables(options.adapter);
  const input = createReadStream(join(options.directory, "workspace.jsonl"));
  const lines = createInterface({ input, crlfDelay: Infinity });
  let tableIndex = -1;
  let columns: Awaited<ReturnType<typeof readSyncTransferColumns>> = [];
  let rowCount = 0;

  try {
    for await (const raw of lines) {
      options.signal?.throwIfAborted();

      if (Buffer.byteLength(raw) > maximumLineBytes)
        throw new Error("Sync transfer row exceeds the 64 MiB archive limit");

      const line = v.parse(ArchiveLineSchema, JSON.parse(raw));

      if (line.kind === "table") {
        tableIndex += 1;
        const table = tables[tableIndex];

        if (!table || table.table !== line.table)
          throw new Error("Sync transfer archive table order differs from its application adapter");

        columns = await readSyncTransferColumns(options.transaction, table);

        if (!isDeepStrictEqual(columns, line.columns))
          throw new Error("Sync transfer target columns differ from the source schema");
      } else {
        const table = tables[tableIndex];

        if (!table || table.table !== line.table)
          throw new Error("Sync transfer archive row has no matching table declaration");

        const [scope] = v.parse(
          v.array(v.object({ workspace: v.string() })),
          await options.transaction.unsafe(
            "SELECT ($1::text::json ->> $2)::uuid::text AS workspace",
            [line.row, table.workspaceColumn],
          ),
        );

        if (scope?.workspace !== options.manifest.binding.source.workspaceIdentifier)
          throw new Error("Sync transfer archive row belongs to another workspace");

        const names = columns.map(({ name }) => quoteSyncTransferIdentifier(name)).join(", ");
        const relation = `public.${quoteSyncTransferIdentifier(table.table)}`;

        await options.transaction.unsafe(
          `INSERT INTO ${relation} (${names}) SELECT ${names} FROM json_populate_record(NULL::${relation}, $1::text::json)`,
          [line.row],
        );
        rowCount += 1;
      }
    }
  } finally {
    lines.close();
    input.destroy();
  }

  if (tableIndex !== tables.length - 1 || rowCount !== options.manifest.rowCount)
    throw new Error("Sync transfer archive is incomplete");
}
