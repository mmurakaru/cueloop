import { sharedWorkspaceTransferAdapter } from "./workspace-transfer.ts";
import {
  createSyncAuthorityDatabase,
  readSyncAuthority,
  readSyncWorkspaceAuthority,
} from "@cueloop/sync/authority/server";
import { SyncAuthorityFenced, SyncAuthorityRecoveryRequired } from "@cueloop/sync/authority";
import { createSyncPresenceAuthority } from "@cueloop/sync/presence/server";
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
import { authorizeSharedWorkspace, SharedWorkspaceAccessError } from "./shared-workspace-access.ts";
import { sharedWorkspaceServerMutators } from "./shared-workspace-authority.ts";
import { readSharedTextRecord } from "./shared-text-authority.ts";
import { SharedTextStateRequestSchema } from "./shared-text.ts";
import { openSharedTextEditor } from "./text-editor-cli.ts";
import { connectSharedRecord } from "./cli-client.ts";
import { SyncExecutionLeaseConflict } from "@cueloop/sync/execution/server";
import { handleSharedExecution } from "./execution-authority.ts";
import { executeSharedRequests } from "./owner-client.ts";

const databaseUrl = process.env.SYNC_DATABASE_URL;
const token = process.env.SYNC_AUTH_TOKEN;
const userIdentifier = process.env.SYNC_USER_ID;

if (!token || !userIdentifier) {
  throw new Error("Sync example requires SYNC_AUTH_TOKEN and SYNC_USER_ID");
}

const connection = databaseUrl ? postgres(databaseUrl) : undefined;
const rawDatabase = connection ? zeroPostgresJS(sharedRecordSchema, connection) : undefined;
const authorityIdentity = rawDatabase
  ? await rawDatabase.transaction((transaction) => readSyncAuthority(transaction))
  : undefined;
const database =
  rawDatabase && authorityIdentity
    ? createSyncAuthorityDatabase({ database: rawDatabase, identity: authorityIdentity })
    : undefined;
const identities = [{ token, userIdentifier }];
const collaboratorToken = process.env.SYNC_COLLABORATOR_AUTH_TOKEN;
const collaboratorIdentifier = process.env.SYNC_COLLABORATOR_USER_ID;

if (databaseUrl && (collaboratorToken || collaboratorIdentifier)) {
  if (
    !collaboratorToken ||
    !collaboratorIdentifier ||
    collaboratorToken === token ||
    collaboratorIdentifier === userIdentifier
  ) {
    throw new Error("Sync collaborator credentials require a distinct token and user identity");
  }

  identities.push({ token: collaboratorToken, userIdentifier: collaboratorIdentifier });
}

const authenticate = async (request: Request) => {
  const identity = identities.find(
    (candidate) => request.headers.get("authorization") === `Bearer ${candidate.token}`,
  );

  return identity
    ? {
        userIdentifier: identity.userIdentifier,
        context: { userIdentifier: identity.userIdentifier },
      }
    : null;
};
const presence = createSyncPresenceAuthority({
  authenticate: async (request) => {
    const principal = await authenticate(request);

    return principal ? { actorIdentifier: principal.userIdentifier } : null;
  },
  authorize: async (access) => {
    if (!connection) return [];

    const rows =
      await connection`SELECT membership.user_identifier FROM sync_workspace_member AS membership JOIN sync_workspace AS workspace ON workspace.id = membership.workspace_identifier WHERE workspace.id = ${access.workspaceIdentifier} AND membership.user_identifier = ANY(${access.actorIdentifiers}) AND membership.deleted_at IS NULL AND workspace.deleted_at IS NULL`;

    return v
      .parse(v.array(v.object({ user_identifier: v.string() })), rows)
      .map((row) => row.user_identifier);
  },
});

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
  const path = new URL(request.url).pathname;

  if (path === "/presence") return presence.fetch(request);

  if (path !== "/operation" && path !== "/text" && path !== "/execution" && path !== "/authority")
    return handleSync(request);

  if (request.method !== "POST")
    return new Response("Method not allowed", { status: 405, headers: { Allow: "POST" } });

  const principal = await authenticate(request);

  if (!principal) return new Response("Unauthorized", { status: 401 });

  if (!database) return new Response("Sync authority database is not configured", { status: 503 });

  try {
    if (path === "/authority") {
      const input = v.parse(
        v.strictObject({ workspaceIdentifier: v.optional(v.pipe(v.string(), v.uuid())) }),
        await request.json(),
      );
      const current = await database.transaction(async (transaction) => {
        const workspaceIdentifier = input.workspaceIdentifier;

        if (!workspaceIdentifier) {
          const authority = await readSyncAuthority(transaction);

          return {
            authority: {
              authorityIdentifier: authority.authorityIdentifier,
              generation: authority.generation,
            },
            phase: "active" as const,
            deploymentPhase: authority.phase,
          };
        }

        await authorizeSharedWorkspace({
          transaction,
          workspaceIdentifier,
          actorIdentifier: principal.userIdentifier,
        });

        return readSyncWorkspaceAuthority(transaction, workspaceIdentifier);
      });

      if (current.phase !== "active" || current.deploymentPhase !== "active")
        throw new SyncAuthorityFenced();

      return Response.json(current.authority, { headers: { "cache-control": "no-store" } });
    }

    if (path === "/execution") {
      const input: unknown = await request.json();

      return await database.transaction((transaction) =>
        handleSharedExecution({ transaction, actorIdentifier: principal.userIdentifier, input }),
      );
    }

    if (path === "/text") {
      const input = v.parse(SharedTextStateRequestSchema, await request.json());
      const record = await database.transaction((transaction) =>
        readSharedTextRecord({
          transaction,
          actorIdentifier: principal.userIdentifier,
          request: input,
        }),
      );

      return Response.json(record);
    }

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
    if (cause instanceof Error) return sharedAuthorityErrorResponse(cause);

    throw cause;
  }
}

export const syncApplication = {
  transferAdapter: sharedWorkspaceTransferAdapter,
  readiness: async (signal: AbortSignal) => {
    if (!rawDatabase || signal.aborted) return { ready: false, phase: "unavailable" as const };

    const authority = await rawDatabase.transaction((transaction) =>
      readSyncAuthority(transaction),
    );

    if (
      !authorityIdentity ||
      authority.authorityIdentifier !== authorityIdentity.authorityIdentifier ||
      authority.generation !== authorityIdentity.generation
    )
      return { ready: false, phase: "fenced" as const };

    return { ready: authority.phase === "active", phase: authority.phase };
  },
  fetch,
  connect: connectSharedRecord,
  execute: executeSharedRequests,
  openText: openSharedTextEditor,
  close: async () => {
    presence.close();
    await connection?.end();
  },
};

function sharedAuthorityErrorResponse(error: Error): Response {
  if (error instanceof SyncAuthorityRecoveryRequired)
    return Response.json({ error: "unknown_after_recovery" }, { status: 425 });

  if (error instanceof SyncAuthorityFenced)
    return Response.json({ error: "authority_fenced" }, { status: 503 });

  if (error instanceof v.ValiError || error instanceof SyntaxError)
    return Response.json({ error: "invalid_operation" }, { status: 400 });

  if (error instanceof SharedWorkspaceAccessError)
    return Response.json({ error: "forbidden" }, { status: 403 });

  if (error instanceof SyncOperationConflict || error instanceof SyncExecutionLeaseConflict)
    return Response.json({ error: "operation_conflict" }, { status: 409 });

  throw error;
}
