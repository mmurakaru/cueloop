import { mustGetMutator, mustGetQuery } from "@rocicorp/zero";
import { zeroPostgresJS } from "@rocicorp/zero/server/adapters/postgresjs";
import {
  createSyncAuthority,
  findSyncOperationReceipt,
  SyncOperationConflict,
} from "@cueloop/sync/server";
import { SyncOperationSchema } from "@cueloop/sync/operations";
import postgres from "postgres";
import * as v from "valibot";
import { sharedRecordSchema } from "./workspace-schema.ts";
import { sharedWorkspaceQueries } from "./shared-workspace.ts";
import {
  sharedWorkspaceServerMutators,
  authorizeSharedWorkspace,
  SharedWorkspaceAccessError,
} from "./shared-comment-authority.ts";
import { connectSharedRecord } from "./cli-client.ts";

const databaseUrl = process.env.SYNC_DATABASE_URL;
const token = process.env.SYNC_AUTH_TOKEN;
const userIdentifier = process.env.SYNC_USER_ID;

if (!token || !userIdentifier) {
  throw new Error("Sync example requires SYNC_AUTH_TOKEN and SYNC_USER_ID");
}

const connection = databaseUrl ? postgres(databaseUrl) : undefined;
const database = connection ? zeroPostgresJS(sharedRecordSchema, connection) : undefined;
const authenticate = async (request: Request) =>
  request.headers.get("authorization") === `Bearer ${token}`
    ? { userIdentifier, context: { userIdentifier } }
    : null;
const handleSync = database
  ? createSyncAuthority({
      schema: sharedRecordSchema,
      database,
      authenticate,
      query: (principal) => (name, args) =>
        mustGetQuery(sharedWorkspaceQueries, name).fn({ args, ctx: principal.context }),
      mutate: (principal) => (transact) =>
        transact((tx, name, args) =>
          mustGetMutator(sharedWorkspaceServerMutators, name).fn({
            tx,
            args,
            ctx: principal.context,
          }),
        ),
    })
  : () => new Response("Sync authority database is not configured", { status: 503 });

async function fetch(request: Request): Promise<Response> {
  if (new URL(request.url).pathname !== "/operation") return handleSync(request);

  if (request.method !== "POST")
    return new Response("Method not allowed", { status: 405, headers: { Allow: "POST" } });

  const principal = await authenticate(request);

  if (!principal) return new Response("Unauthorized", { status: 401 });

  if (!database) return new Response("Sync authority database is not configured", { status: 503 });

  try {
    const operation = v.parse(SyncOperationSchema, await request.json());
    const receipt = await database.transaction((transaction) =>
      findSyncOperationReceipt({
        transaction,
        definition: { schema: SyncOperationSchema },
        operation,
        actorIdentifier: principal.userIdentifier,
        authorize: async (receiptTransaction, pendingOperation) => {
          await authorizeSharedWorkspace({
            transaction: receiptTransaction,
            workspaceIdentifier: pendingOperation.workspaceIdentifier,
            actorIdentifier: principal.userIdentifier,
          });
        },
      }),
    );

    return Response.json({ receipt: receipt ?? null });
  } catch (cause) {
    if (cause instanceof v.ValiError || cause instanceof SyntaxError)
      return Response.json({ error: "invalid_operation" }, { status: 400 });

    if (cause instanceof SharedWorkspaceAccessError)
      return Response.json({ error: "forbidden" }, { status: 403 });

    if (cause instanceof SyncOperationConflict)
      return Response.json({ error: "operation_conflict" }, { status: 409 });

    throw cause;
  }
}

export const syncApplication = {
  fetch,
  connect: connectSharedRecord,
  close: () => connection?.end(),
};
