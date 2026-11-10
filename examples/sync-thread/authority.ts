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
const application = createSyncThreadApplication({
  database: zeroPostgresJS(syncThreadSchema, connection),
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

export const syncApplication = { ...application, close: () => connection.end() };
