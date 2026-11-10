import type postgres from "postgres";
import * as v from "valibot";
import canonicalize from "canonicalize";
import { createHash } from "node:crypto";

const SqlIdentifierSchema = v.pipe(v.string(), v.regex(/^[a-z_][a-z0-9_]*$/));
export const SyncTransferTableSchema = v.strictObject({
  table: SqlIdentifierSchema,
  workspaceColumn: SqlIdentifierSchema,
});

export interface SyncWorkspaceTransferAdapter {
  identifier: string;
  tables: readonly v.InferOutput<typeof SyncTransferTableSchema>[];
  verifyImport: (
    transaction: postgres.TransactionSql,
    workspaceIdentifier: string,
  ) => Promise<void>;
}
export type SyncTransferTable = v.InferOutput<typeof SyncTransferTableSchema>;

/** Applications declare complete table ownership; privileged SQL outside workspace fences is unsupported. */
export function defineSyncWorkspaceTransferAdapter(adapter: SyncWorkspaceTransferAdapter) {
  const identifier = v.parse(
    v.pipe(v.string(), v.minLength(1), v.maxLength(200)),
    adapter.identifier,
  );
  const tables = v.parse(v.pipe(v.array(SyncTransferTableSchema), v.minLength(1)), adapter.tables);

  if (
    new Set(tables.map(({ table }) => table)).size !== tables.length ||
    tables.some(({ table }) =>
      [
        "sync_authority",
        "sync_workspace_authority",
        "sync_schema_migration",
        "sync_operation_receipt",
        "sync_execution",
        "sync_workspace_transfer",
      ].includes(table),
    )
  )
    throw new Error("Sync transfer application tables must be unique and exclude SDK tables");

  return Object.freeze({
    identifier,
    tables: Object.freeze(tables),
    verifyImport: adapter.verifyImport,
  });
}

export function syncTransferAdapterDigest(adapter: SyncWorkspaceTransferAdapter) {
  return createHash("sha256")
    .update(canonicalize({ identifier: adapter.identifier, tables: adapter.tables })!)
    .digest("hex");
}

export function syncTransferTables(
  adapter: SyncWorkspaceTransferAdapter,
): readonly SyncTransferTable[] {
  return [
    ...adapter.tables,
    { table: "sync_operation_receipt", workspaceColumn: "workspace_identifier" },
    { table: "sync_execution", workspaceColumn: "workspace_identifier" },
  ];
}

/** The row remains PostgreSQL JSON text so numeric values never pass through JavaScript numbers. */
export async function readSyncTransferColumns(
  transaction: postgres.TransactionSql,
  table: SyncTransferTable,
) {
  v.parse(SyncTransferTableSchema, table);
  const columns = v.parse(
    v.array(v.object({ name: SqlIdentifierSchema, type: v.string() })),
    await transaction`SELECT attribute.attname AS name, format_type(attribute.atttypid, attribute.atttypmod) AS type FROM pg_attribute AS attribute JOIN pg_class AS relation ON relation.oid = attribute.attrelid JOIN pg_namespace AS namespace ON namespace.oid = relation.relnamespace WHERE namespace.nspname = 'public' AND relation.relname = ${table.table} AND attribute.attnum > 0 AND NOT attribute.attisdropped AND attribute.attgenerated = '' ORDER BY attribute.attnum`,
  );

  if (
    !columns.some(({ name }) => name === table.workspaceColumn) ||
    !columns.some(({ name }) => name === "id")
  )
    throw new Error("Sync transfer table requires its declared workspace column and immutable id");

  return columns;
}

export function quoteSyncTransferIdentifier(identifier: string) {
  return `"${v.parse(SqlIdentifierSchema, identifier)}"`;
}
