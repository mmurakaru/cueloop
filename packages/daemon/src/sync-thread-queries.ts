import { createBuilder, defineQueriesWithType, defineQueryWithType } from "@cueloop/sync/schema";
import * as v from "valibot";
import { syncThreadSchema } from "./sync-thread-schema";

export interface SyncThreadContext {
  actorIdentifier: string;
}

const IdentifierSchema = v.pipe(v.string(), v.uuid(), v.toLowerCase());
const PageSizeSchema = v.optional(
  v.pipe(v.number(), v.safeInteger(), v.minValue(1), v.maxValue(100)),
  50,
);
const builder = createBuilder(syncThreadSchema);
const defineThreadQuery = defineQueryWithType<typeof syncThreadSchema, SyncThreadContext>();

export const SyncThreadRecordRequestSchema = v.strictObject({
  workspaceIdentifier: IdentifierSchema,
  recordIdentifier: IdentifierSchema,
});

export const syncThreadQueries = defineQueriesWithType<typeof syncThreadSchema>()({
  workspaces: defineThreadQuery(
    v.strictObject({
      pageSize: PageSizeSchema,
      cursor: v.optional(
        v.strictObject({ createdAt: v.pipe(v.number(), v.safeInteger()), id: IdentifierSchema }),
      ),
    }),
    ({ args: parameters, ctx: principal }) => {
      let query = builder.cueloop_sync_workspace
        .where("deletedAt", "IS", null)
        .whereExists("memberships", (members) =>
          members
            .where("actorIdentifier", principal.actorIdentifier)
            .where("deletedAt", "IS", null),
        )
        .related("memberships", (members) =>
          members
            .where("actorIdentifier", principal.actorIdentifier)
            .where("deletedAt", "IS", null),
        )
        .orderBy("createdAt", "desc")
        .orderBy("id", "desc")
        .limit(parameters.pageSize);

      if (parameters.cursor) query = query.start(parameters.cursor);

      return query;
    },
  ),
  workspace: defineThreadQuery(
    v.strictObject({ workspaceIdentifier: IdentifierSchema }),
    ({ args: parameters, ctx: principal }) =>
      builder.cueloop_sync_workspace
        .where("id", parameters.workspaceIdentifier)
        .where("deletedAt", "IS", null)
        .whereExists("memberships", (members) =>
          members
            .where("actorIdentifier", principal.actorIdentifier)
            .where("deletedAt", "IS", null),
        )
        .related("memberships", (members) =>
          members
            .where("actorIdentifier", principal.actorIdentifier)
            .where("deletedAt", "IS", null),
        )
        .one(),
  ),
  threads: defineThreadQuery(
    v.strictObject({
      workspaceIdentifier: IdentifierSchema,
      pageSize: PageSizeSchema,
      cursor: v.optional(
        v.strictObject({
          threadCreatedAt: v.pipe(v.number(), v.safeInteger()),
          id: IdentifierSchema,
        }),
      ),
    }),
    ({ args: parameters, ctx: principal }) => {
      let query = builder.cueloop_sync_thread
        .where("workspaceIdentifier", parameters.workspaceIdentifier)
        .where("deletedAt", "IS", null)
        .whereExists("workspace", (workspace) => workspace.where("deletedAt", "IS", null))
        .whereExists("memberships", (members) =>
          members
            .where("actorIdentifier", principal.actorIdentifier)
            .where("deletedAt", "IS", null),
        )
        .orderBy("threadCreatedAt", "desc")
        .orderBy("id", "desc")
        .limit(parameters.pageSize);

      if (parameters.cursor) query = query.start(parameters.cursor);

      return query;
    },
  ),
  document: defineThreadQuery(
    SyncThreadRecordRequestSchema,
    ({ args: parameters, ctx: principal }) =>
      builder.cueloop_sync_thread_document
        .where("id", parameters.recordIdentifier)
        .where("workspaceIdentifier", parameters.workspaceIdentifier)
        .where("deletedAt", "IS", null)
        .whereExists("workspace", (workspace) => workspace.where("deletedAt", "IS", null))
        .whereExists("memberships", (members) =>
          members
            .where("actorIdentifier", principal.actorIdentifier)
            .where("deletedAt", "IS", null),
        )
        .whereExists("thread", (thread) =>
          thread
            .where("workspaceIdentifier", parameters.workspaceIdentifier)
            .where("deletedAt", "IS", null),
        )
        .related("thread")
        .one(),
  ),
  ownerDocument: defineThreadQuery(
    SyncThreadRecordRequestSchema,
    ({ args: parameters, ctx: principal }) =>
      builder.cueloop_sync_thread_state
        .where("id", parameters.recordIdentifier)
        .where("workspaceIdentifier", parameters.workspaceIdentifier)
        .where("deletedAt", "IS", null)
        .whereExists("workspace", (workspace) => workspace.where("deletedAt", "IS", null))
        .whereExists("memberships", (members) =>
          members
            .where("actorIdentifier", principal.actorIdentifier)
            .where("role", "owner")
            .where("deletedAt", "IS", null),
        )
        .whereExists("thread", (thread) =>
          thread
            .where("workspaceIdentifier", parameters.workspaceIdentifier)
            .where("deletedAt", "IS", null),
        )
        .related("thread")
        .related("projection")
        .one(),
  ),
});
