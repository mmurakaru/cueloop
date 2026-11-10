import {
  claimSyncExecution,
  reportSyncExecution,
  type SyncExecutionTransaction,
} from "@cueloop/sync/execution/server";
import { SyncExecutionRequestSchema } from "@cueloop/sync/execution";
import * as v from "valibot";
import { authorizeSharedWorkspace, SharedWorkspaceAccessError } from "./shared-workspace-access.ts";

export async function handleSharedExecution(options: {
  transaction: SyncExecutionTransaction;
  actorIdentifier: string;
  input: unknown;
}) {
  const input = v.parse(SyncExecutionRequestSchema, options.input);
  const workspaceIdentifier =
    input.action === "claim" ? input.workspaceIdentifier : input.claim.workspaceIdentifier;
  const access = {
    transaction: options.transaction,
    actorIdentifier: options.actorIdentifier,
    workspaceIdentifier,
    authorize: async (
      transaction: SyncExecutionTransaction,
      identity: { workspaceIdentifier: string; actorIdentifier: string },
    ) => {
      const membership = await authorizeSharedWorkspace({ transaction, ...identity });

      if (membership.role !== "owner") throw new SharedWorkspaceAccessError();
    },
  };

  if (input.action === "claim") {
    const claim = await claimSyncExecution({
      ...access,
      executorIdentifier: input.executorIdentifier,
    });

    return Response.json({ claim }, { headers: { "cache-control": "no-store" } });
  }

  await reportSyncExecution({ ...access, report: input });

  return new Response(null, { status: 204 });
}
