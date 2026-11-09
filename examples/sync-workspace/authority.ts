import { mustGetMutator, mustGetQuery } from "@rocicorp/zero";
import { zeroPostgresJS } from "@rocicorp/zero/server/adapters/postgresjs";
import { createSyncAuthority } from "@cueloop/sync/server";
import postgres from "postgres";
import { sharedRecordMutators, sharedRecordQueries, sharedRecordSchema } from "./shared-record.ts";
import { connectSharedRecord } from "./client.ts";

const databaseUrl = process.env.SYNC_DATABASE_URL;
const token = process.env.SYNC_AUTH_TOKEN;
const userIdentifier = process.env.SYNC_USER_ID;

if (!token || !userIdentifier) {
  throw new Error("Sync example requires SYNC_AUTH_TOKEN and SYNC_USER_ID");
}

const connection = databaseUrl ? postgres(databaseUrl) : undefined;
const fetch = connection
  ? createSyncAuthority({
      schema: sharedRecordSchema,
      database: zeroPostgresJS(sharedRecordSchema, connection),
      authenticate: async (request) =>
        request.headers.get("authorization") === `Bearer ${token}`
          ? { userIdentifier, context: { canEdit: true } }
          : null,
      query: (principal) => (name, args) =>
        mustGetQuery(sharedRecordQueries, name).fn({ args, ctx: principal.context }),
      mutate: (principal) => (transact) =>
        transact((tx, name, args) =>
          mustGetMutator(sharedRecordMutators, name).fn({ tx, args, ctx: principal.context }),
        ),
    })
  : () => new Response("Sync authority database is not configured", { status: 503 });

export const syncApplication = {
  fetch,
  connect: connectSharedRecord,
  close: () => connection?.end(),
};
