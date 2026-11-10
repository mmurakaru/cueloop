import postgres from "postgres";
import * as v from "valibot";
import { mkdir, open, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { SyncAuthorityIdentitySchema } from "./sync-authority-protocol.ts";
import {
  SyncBackupManifestSchema,
  SyncMigrationDigestSchema,
  digestSyncBackupArchive,
} from "./sync-backup-manifest.ts";
import { runSyncPostgresTool, type SyncPostgresTools } from "./sync-postgres-tools.ts";

/** Canonical schemas and receipts share one PostgreSQL snapshot; derived Zero metadata is excluded. */
export async function createSyncBackup(options: {
  databaseURL: string;
  directory: string;
  schemas?: string[];
  tools?: SyncPostgresTools;
  signal?: AbortSignal;
}) {
  const schemas = v.parse(SyncBackupManifestSchema.entries.schemas, options.schemas ?? ["public"]);

  if (!schemas.includes("public"))
    throw new Error("Sync backup must include the public SDK schema");

  const directory = resolve(options.directory);

  if (
    await stat(directory).then(
      () => true,
      () => false,
    )
  )
    throw new Error("Sync backup destination already exists");

  const preparing = `${directory}.preparing.${randomUUID()}`;

  await mkdir(preparing, { mode: 0o700 });
  const database = postgres(options.databaseURL, { max: 1, onnotice: () => {} });

  try {
    const manifest = await database.begin(
      "isolation level repeatable read read only",
      async (transaction) => {
        const [row] =
          await transaction`SELECT id::text AS "authorityIdentifier", generation::text, phase, schema_revision AS "schemaRevision", current_setting('server_version_num')::integer AS "serverVersion", transaction_timestamp() AS "snapshotStartedAt", pg_export_snapshot() AS snapshot FROM public.sync_authority WHERE singleton AND deleted_at IS NULL`;
        const source = v.parse(
          v.object({
            ...SyncAuthorityIdentitySchema.entries,
            phase: v.picklist(["active", "fenced"]),
            schemaRevision: v.literal(1),
            serverVersion: SyncBackupManifestSchema.entries.serverVersion,
            snapshotStartedAt: v.date(),
            snapshot: v.pipe(v.string(), v.regex(/^[0-9A-Fa-f-]+$/)),
          }),
          row,
        );
        const migrations = v.parse(
          v.array(SyncMigrationDigestSchema),
          await transaction`SELECT identity, digest FROM public.sync_schema_migration WHERE deleted_at IS NULL ORDER BY identity`,
        );
        const archive = join(preparing, "application.dump");

        await runSyncPostgresTool({
          command: options.tools?.dump ?? ["pg_dump"],
          arguments: [
            "--format=custom",
            "--no-password",
            "--no-owner",
            "--no-acl",
            "--no-publications",
            "--no-subscriptions",
            "--strict-names",
            `--snapshot=${source.snapshot}`,
            "--exclude-table-data=public.sync_authority",
            ...schemas.map((schema) => `--schema=${schema}`),
          ],
          databaseURL: options.databaseURL,
          outputPath: archive,
          signal: options.signal,
        });
        await runSyncPostgresTool({
          command: options.tools?.restore ?? ["pg_restore"],
          arguments: ["--list"],
          databaseURL: options.databaseURL,
          inputPath: archive,
          signal: options.signal,
        });

        return v.parse(SyncBackupManifestSchema, {
          format: "cueloop-sync-postgresql",
          version: 1,
          authority: {
            authorityIdentifier: source.authorityIdentifier,
            generation: source.generation,
          },
          schemaRevision: source.schemaRevision,
          serverVersion: source.serverVersion,
          snapshotStartedAt: source.snapshotStartedAt.toISOString(),
          schemas,
          migrations,
          archiveDigest: await digestSyncBackupArchive(archive),
        });
      },
    );

    await writeFile(join(preparing, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, {
      mode: 0o600,
      flag: "wx",
    });
    const metadata = await open(join(preparing, "manifest.json"), "r");

    try {
      await metadata.sync();
    } finally {
      await metadata.close();
    }
    await syncBackupDirectory(preparing);
    options.signal?.throwIfAborted();
    await rename(preparing, directory);
    await syncBackupDirectory(dirname(directory));

    return { directory, manifest };
  } finally {
    await database.end();
    await rm(preparing, { recursive: true, force: true });
  }
}

export async function syncBackupDirectory(directory: string): Promise<void> {
  const handle = await open(directory, "r");

  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}
