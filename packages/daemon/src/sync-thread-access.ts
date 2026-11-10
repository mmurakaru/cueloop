import type { ServerTransaction } from "@rocicorp/zero";
import * as v from "valibot";
import type { syncThreadSchema } from "./sync-thread-schema";
import type { SyncThreadPrincipal } from "./sync-thread-command";

export type SyncThreadTransaction = Pick<
  ServerTransaction<typeof syncThreadSchema, unknown>,
  "location" | "dbTransaction"
>;
const MembershipSchema = v.object({ role: v.picklist(["viewer", "editor", "owner"]) });

export class SyncThreadAccessError extends Error {
  constructor() {
    super("Sync Thread workspace access is not permitted");
    this.name = "SyncThreadAccessError";
  }
}

/** Permission changes serialize with the application transaction that reads or mutates the Thread. */
export async function authorizeSyncThreadWorkspace(options: {
  transaction: SyncThreadTransaction;
  workspaceIdentifier: string;
  actorIdentifier: string;
}): Promise<SyncThreadPrincipal> {
  const rows = await options.transaction.dbTransaction.query(
    "SELECT membership.role FROM cueloop_sync_workspace_member AS membership JOIN cueloop_sync_workspace AS workspace ON workspace.id = membership.workspace_identifier WHERE workspace.id = $1 AND membership.actor_identifier = $2 AND membership.deleted_at IS NULL AND workspace.deleted_at IS NULL FOR SHARE OF membership, workspace",
    [options.workspaceIdentifier, options.actorIdentifier],
  );
  const [membership] = v.parse(v.array(MembershipSchema), [...rows]);

  if (!membership) throw new SyncThreadAccessError();

  return { actorIdentifier: options.actorIdentifier, role: membership.role };
}
