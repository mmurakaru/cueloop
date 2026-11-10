import { defineSyncWorkspaceTransferAdapter } from "@cueloop/sync/transfer";

export const syncThreadTransferAdapter = defineSyncWorkspaceTransferAdapter({
  identifier: "cueloop-thread-workspace/v1",
  tables: [
    { table: "cueloop_sync_workspace", workspaceColumn: "id" },
    { table: "cueloop_sync_workspace_member", workspaceColumn: "workspace_identifier" },
    { table: "cueloop_sync_thread", workspaceColumn: "workspace_identifier" },
    { table: "cueloop_sync_thread_state", workspaceColumn: "workspace_identifier" },
    { table: "cueloop_sync_thread_document", workspaceColumn: "workspace_identifier" },
    { table: "cueloop_sync_thread_payload", workspaceColumn: "workspace_identifier" },
  ],
  verifyImport: async (transaction, workspaceIdentifier) => {
    const [owner] =
      await transaction`SELECT id FROM cueloop_sync_workspace_member WHERE workspace_identifier = ${workspaceIdentifier} AND role = 'owner' AND deleted_at IS NULL LIMIT 1`;
    const [incomplete] =
      await transaction`SELECT thread.id FROM cueloop_sync_thread AS thread LEFT JOIN cueloop_sync_thread_state AS state ON state.id = thread.id AND state.workspace_identifier = thread.workspace_identifier LEFT JOIN cueloop_sync_thread_document AS document ON document.id = thread.id AND document.workspace_identifier = thread.workspace_identifier WHERE thread.workspace_identifier = ${workspaceIdentifier} AND (state.id IS NULL OR document.id IS NULL) LIMIT 1`;

    if (!owner || incomplete)
      throw new Error(
        "Sync Thread transfer requires owner membership and complete private and public documents",
      );
  },
});
