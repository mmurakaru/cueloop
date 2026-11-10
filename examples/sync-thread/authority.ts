import { createSyncAuthorityDatabase, readSyncAuthority } from "@cueloop/sync/authority/server";
import postgres from "postgres";
import { zeroPostgresJS } from "@rocicorp/zero/server/adapters/postgresjs";
import { createSyncThreadApplication } from "@cueloop/daemon/sync-thread-authority";
import { syncThreadSchema } from "@cueloop/daemon/sync-thread-schema";

const databaseURL = process.env.SYNC_DATABASE_URL;
const ownerToken = process.env.SYNC_AUTH_TOKEN;
const ownerIdentifier = process.env.SYNC_USER_ID;

if (!databaseURL || !ownerToken || !ownerIdentifier)
  throw new Error("Sync Thread authority requires database and owner credentials");

const connection = postgres(databaseURL);
const identities = [
  { token: ownerToken, actorIdentifier: ownerIdentifier },
  {
    token: process.env.SYNC_COLLABORATOR_AUTH_TOKEN,
    actorIdentifier: process.env.SYNC_COLLABORATOR_USER_ID,
  },
];
const rawDatabase = zeroPostgresJS(syncThreadSchema, connection);
const identity = await rawDatabase.transaction((transaction) => readSyncAuthority(transaction));
const application = createSyncThreadApplication({
  database: createSyncAuthorityDatabase({ database: rawDatabase, identity }),
  authenticate: async (request) => {
    const identity = identities.find(
      (candidate) =>
        candidate.token &&
        candidate.actorIdentifier &&
        request.headers.get("authorization") === `Bearer ${candidate.token}`,
    );

    return identity?.actorIdentifier ? { actorIdentifier: identity.actorIdentifier } : null;
  },
});

export const syncApplication = {
  ...application,
  readiness: async (signal: AbortSignal) => {
    if (signal.aborted) return { ready: false, phase: "unavailable" as const };

    const authority = await rawDatabase.transaction((transaction) =>
      readSyncAuthority(transaction),
    );

    return { ready: authority.phase === "active", phase: authority.phase };
  },
  close: () => connection.end(),
};
