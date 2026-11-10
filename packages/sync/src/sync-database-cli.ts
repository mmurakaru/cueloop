import { readSyncCommandFlag, readSyncDatabaseCredential } from "./sync-command-arguments.ts";
import { initializeSyncDatabase, activateSyncDatabase } from "./sync-database-initialize.ts";
import { readFile } from "node:fs/promises";
import * as v from "valibot";
import { createSyncBackup } from "./sync-backup.ts";
import { restoreSyncBackup, activateSyncRestore, fenceSyncAuthority } from "./sync-restore.ts";
import { migrateSyncDatabase } from "./sync-database-migration.ts";
import { readSyncDatabaseStatus } from "./sync-database-status.ts";
import { SyncAuthorityIdentitySchema } from "./sync-authority-protocol.ts";
import { loadSyncApplication } from "./sync-application.ts";

export const SYNC_DATABASE_HELP = `Usage: cueloop-sync database <initialize|backup|restore|status|migrate|fence|activate> --database-env <name> [options]

  initialize Install the SDK schema into an empty database
  backup    Write a consistent canonical archive to --directory <new-path>
  restore   Restore --directory <path> into a clean offline database
  status    Print authority identity, recovery phase, and held execution count
  migrate   Apply --migrations <json-file> while the authority is offline
  fence     Drain writes for --authority <identity-json-file>
  activate  Verify the source fence and fresh replica for --recovery <json-file>

Activation requires --source-database-env <name> and --application <module> with verifyReplica.
Migration files contain an array of {identity, path} entries.
PostgreSQL credentials must be stored in the named environment variables.
Restore does not activate traffic or resume held execution requests.
`;

export async function runSyncDatabaseCli(arguments_: string[]): Promise<number> {
  const command = arguments_[0];

  if (!command || arguments_.includes("--help")) {
    process.stdout.write(SYNC_DATABASE_HELP);

    return 0;
  }

  if (
    !["initialize", "backup", "restore", "status", "migrate", "fence", "activate"].includes(command)
  )
    throw new Error("Sync database command is unknown");

  const databaseURL = readSyncDatabaseCredential(arguments_, "--database-env", "SYNC_DATABASE_URL");
  let result: unknown;

  switch (command) {
    case "initialize":
      result = await initializeSyncDatabase({ databaseURL });
      break;
    case "backup":
      result = await createSyncBackup({
        databaseURL,
        directory: readSyncCommandFlag(arguments_, "--directory"),
      });
      break;
    case "restore":
      result = await restoreSyncBackup({
        databaseURL,
        directory: readSyncCommandFlag(arguments_, "--directory"),
      });
      break;
    case "status":
      result = await readSyncDatabaseStatus(databaseURL);
      break;
    case "migrate": {
      const migrations = v.parse(
        v.array(v.strictObject({ identity: v.string(), path: v.string() })),
        JSON.parse(await readFile(readSyncCommandFlag(arguments_, "--migrations"), "utf8")),
      );

      result = await migrateSyncDatabase({ databaseURL, migrations });
      break;
    }
    case "fence":
      result = await fenceSyncAuthority({
        databaseURL,
        authority: v.parse(
          SyncAuthorityIdentitySchema,
          JSON.parse(await readFile(readSyncCommandFlag(arguments_, "--authority"), "utf8")),
        ),
      });
      break;
    case "activate": {
      const recovery = v.parse(
        v.object({
          authority: SyncAuthorityIdentitySchema,
          source: v.nullable(SyncAuthorityIdentitySchema),
        }),
        JSON.parse(await readFile(readSyncCommandFlag(arguments_, "--recovery"), "utf8")),
      );
      const sourceDatabaseURL = recovery.source
        ? readSyncDatabaseCredential(arguments_, "--source-database-env")
        : undefined;
      const application = await loadSyncApplication(
        readSyncCommandFlag(arguments_, "--application"),
      );

      try {
        if (!application.verifyReplica)
          throw new Error(
            "Sync restore application requires verifyReplica to prove fresh cache readiness",
          );

        result =
          recovery.source && sourceDatabaseURL
            ? await activateSyncRestore({
                databaseURL,
                sourceDatabaseURL,
                source: recovery.source,
                authority: recovery.authority,
                verifyReplica: application.verifyReplica,
              })
            : await activateSyncDatabase({
                databaseURL,
                authority: recovery.authority,
                verifyReplica: application.verifyReplica,
              });
      } finally {
        await application.close?.();
      }

      break;
    }
  }

  process.stdout.write(`${JSON.stringify(result)}\n`);

  return 0;
}
