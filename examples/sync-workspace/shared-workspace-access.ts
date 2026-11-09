import type { ServerTransaction } from "@rocicorp/zero";
import * as v from "valibot";
import { sharedRecordSchema } from "./workspace-schema.ts";

const MembershipSchema = v.object({ role: v.picklist(["viewer", "editor", "owner"]) });

type SharedWorkspaceTransaction = ServerTransaction<typeof sharedRecordSchema, unknown>;
export interface SharedWorkspaceAccess {
  workspaceIdentifier: string;
  actorIdentifier: string;
  role: v.InferOutput<typeof MembershipSchema>["role"];
}

export class SharedWorkspaceAccessError extends Error {
  constructor() {
    super("Shared workspace access is not permitted");
    this.name = "SharedWorkspaceAccessError";
  }
}

export async function authorizeSharedWorkspace(options: {
  transaction: SharedWorkspaceTransaction;
  workspaceIdentifier: string;
  actorIdentifier: string;
}): Promise<SharedWorkspaceAccess> {
  const memberships = await options.transaction.dbTransaction.query(
    "SELECT membership.role FROM sync_workspace_member AS membership JOIN sync_workspace AS workspace ON workspace.id = membership.workspace_identifier WHERE workspace.id = $1 AND membership.user_identifier = $2 AND membership.deleted_at IS NULL AND workspace.deleted_at IS NULL FOR SHARE OF membership, workspace",
    [options.workspaceIdentifier, options.actorIdentifier],
  );
  const [membership] = v.parse(v.array(MembershipSchema), [...memberships]);

  if (!membership) throw new SharedWorkspaceAccessError();

  return {
    workspaceIdentifier: options.workspaceIdentifier,
    actorIdentifier: options.actorIdentifier,
    role: membership.role,
  };
}
