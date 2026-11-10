import { readFile } from "node:fs/promises";
import * as v from "valibot";
import { readSyncCommandFlag, readSyncDatabaseCredential } from "./sync-command-arguments.ts";
import { loadSyncApplication } from "./sync-application.ts";
import {
  SyncTransferBindingSchema,
  prepareSyncWorkspaceTransfer,
  importSyncWorkspaceTransfer,
  activateSyncWorkspaceTransfer,
  readSyncWorkspaceTransfer,
} from "./sync-transfer.ts";

const SYNC_WORKSPACE_HELP = `Usage: cueloop-sync workspace transfer <prepare|import|activate|status> [options]

  prepare   Fence the source and export --directory <new-path> using --binding <json-file>
  import    Import --directory <path> into its reserved destination
  activate  Prove replica visibility and activate --binding <json-file>
  status    Inspect the handoff for --workspace <uuid>

Use --database-env <name> for the current database and --source-database-env <name> for import or activation.
Prepare, import, and activate require --application <module> with transferAdapter.
Activation requires verifyWorkspaceReplica. Failed handoffs retain the source fence.
`;

export async function runSyncWorkspaceCli(arguments_: string[]) {
  const command = arguments_[1];

  if (arguments_.includes("--help") || arguments_.length === 0) {
    process.stdout.write(SYNC_WORKSPACE_HELP);

    return 0;
  }

  if (
    arguments_[0] !== "transfer" ||
    !command ||
    !["prepare", "import", "activate", "status"].includes(command)
  )
    throw new Error("Sync workspace transfer command is unknown");

  const databaseURL = readSyncDatabaseCredential(arguments_, "--database-env", "SYNC_DATABASE_URL");

  if (command === "status") {
    const result = await readSyncWorkspaceTransfer({
      databaseURL,
      workspaceIdentifier: readSyncCommandFlag(arguments_, "--workspace"),
    });

    process.stdout.write(`${JSON.stringify(result ?? { status: "unreserved" })}\n`);

    return 0;
  }

  const application = await loadSyncApplication(readSyncCommandFlag(arguments_, "--application"));

  try {
    if (!application.transferAdapter) throw new Error("Sync application requires transferAdapter");

    let result: unknown;

    if (command === "import") {
      result = await importSyncWorkspaceTransfer({
        databaseURL,
        sourceDatabaseURL: readSyncDatabaseCredential(arguments_, "--source-database-env"),
        directory: readSyncCommandFlag(arguments_, "--directory"),
        adapter: application.transferAdapter,
      });
    } else {
      const binding = v.parse(
        SyncTransferBindingSchema,
        JSON.parse(await readFile(readSyncCommandFlag(arguments_, "--binding"), "utf8")),
      );

      if (command === "prepare") {
        result = await prepareSyncWorkspaceTransfer({
          databaseURL,
          directory: readSyncCommandFlag(arguments_, "--directory"),
          binding,
          adapter: application.transferAdapter,
        });
      } else {
        if (!application.verifyWorkspaceReplica)
          throw new Error("Sync application requires verifyWorkspaceReplica");

        result = await activateSyncWorkspaceTransfer({
          databaseURL,
          sourceDatabaseURL: readSyncDatabaseCredential(arguments_, "--source-database-env"),
          binding,
          verifyReplica: application.verifyWorkspaceReplica,
        });
      }
    }

    process.stdout.write(`${JSON.stringify(result)}\n`);

    return 0;
  } finally {
    await application.close?.();
  }
}
