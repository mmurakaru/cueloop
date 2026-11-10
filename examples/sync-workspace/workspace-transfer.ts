import { defineSyncWorkspaceTransferAdapter } from "@cueloop/sync/transfer";

export const sharedWorkspaceTransferAdapter = defineSyncWorkspaceTransferAdapter({
  identifier: "cueloop-shared-workspace/v1",
  tables: [
    { table: "sync_workspace", workspaceColumn: "id" },
    { table: "sync_workspace_member", workspaceColumn: "workspace_identifier" },
    { table: "shared_record", workspaceColumn: "workspace_identifier" },
    { table: "shared_comment", workspaceColumn: "workspace_identifier" },
    { table: "shared_text_revision", workspaceColumn: "workspace_identifier" },
  ],
  verifyImport: async (transaction, workspaceIdentifier) => {
    const [owner] =
      await transaction`SELECT id FROM sync_workspace_member WHERE workspace_identifier = ${workspaceIdentifier} AND role = 'owner' AND deleted_at IS NULL LIMIT 1`;

    if (!owner) throw new Error("Sync workspace transfer requires its retained owner membership");
  },
});
