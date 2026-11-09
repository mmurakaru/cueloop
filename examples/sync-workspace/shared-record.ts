import {
  createBuilder,
  createSchema,
  defineMutatorsWithType,
  defineMutatorWithType,
  defineQueriesWithType,
  defineQueryWithType,
  number,
  relationships,
  string,
  table,
} from "@cueloop/sync/schema";
import * as v from "valibot";

const sharedRecord = table("shared_record")
  .columns({
    id: string(),
    workspaceIdentifier: string().from("workspace_identifier"),
    content: string(),
    createdAt: number().from("created_at"),
    updatedAt: number().from("updated_at"),
    deletedAt: number().optional().from("deleted_at"),
  })
  .primaryKey("id");

const syncWorkspace = table("sync_workspace")
  .columns({
    id: string(),
    title: string(),
    createdAt: number().from("created_at"),
    updatedAt: number().from("updated_at"),
    deletedAt: number().optional().from("deleted_at"),
  })
  .primaryKey("id");
const syncWorkspaceMember = table("sync_workspace_member")
  .columns({
    id: string(),
    workspaceIdentifier: string().from("workspace_identifier"),
    userIdentifier: string().from("user_identifier"),
    role: string(),
    createdAt: number().from("created_at"),
    updatedAt: number().from("updated_at"),
    deletedAt: number().optional().from("deleted_at"),
  })
  .primaryKey("id");
const recordRelationships = relationships(sharedRecord, ({ many, one }) => ({
  memberships: many({
    sourceField: ["workspaceIdentifier"],
    destField: ["workspaceIdentifier"],
    destSchema: syncWorkspaceMember,
  }),
  workspace: one({
    sourceField: ["workspaceIdentifier"],
    destField: ["id"],
    destSchema: syncWorkspace,
  }),
}));

export const sharedRecordSchema = createSchema({
  tables: [sharedRecord, syncWorkspace, syncWorkspaceMember],
  relationships: [recordRelationships],
  enableLegacyQueries: false,
  enableLegacyMutators: false,
});

export interface SharedRecordContext {
  userIdentifier: string;
}

const builder = createBuilder(sharedRecordSchema);
const defineRecordQuery = defineQueryWithType<typeof sharedRecordSchema, SharedRecordContext>();
const defineRecordMutator = defineMutatorWithType<typeof sharedRecordSchema, SharedRecordContext>();

export const sharedRecordQueryArgumentsSchema = v.object({
  workspaceIdentifier: v.optional(v.pipe(v.string(), v.uuid())),
  pageSize: v.optional(v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(100)), 50),
  cursor: v.optional(v.object({ createdAt: v.number(), id: v.pipe(v.string(), v.uuid()) })),
});

export const sharedRecordQueries = defineQueriesWithType<typeof sharedRecordSchema>()({
  records: defineRecordQuery(v.optional(sharedRecordQueryArgumentsSchema), ({ args, ctx }) => {
    let query = builder.shared_record
      .where("deletedAt", "IS", null)
      .whereExists("workspace", (workspace) => workspace.where("deletedAt", "IS", null))
      .whereExists("memberships", (membership) =>
        membership.where("userIdentifier", ctx.userIdentifier).where("deletedAt", "IS", null),
      )
      .related("workspace")
      .orderBy("createdAt", "desc")
      .orderBy("id", "asc")
      .limit(args?.pageSize ?? 50);

    if (args?.workspaceIdentifier)
      query = query.where("workspaceIdentifier", args.workspaceIdentifier);

    if (args?.cursor) query = query.start(args.cursor);

    return query;
  }),
});

export const sharedRecordMutators = defineMutatorsWithType<typeof sharedRecordSchema>()({
  edit: defineRecordMutator(
    v.object({
      id: v.pipe(v.string(), v.uuid()),
      content: v.pipe(v.string(), v.maxLength(100000)),
    }),
    async ({ tx, args, ctx }) => {
      if (tx.location === "server") {
        await tx.dbTransaction.query("SELECT id FROM shared_record WHERE id = $1 FOR UPDATE", [
          args.id,
        ]);
      }

      const record = await tx.run(
        builder.shared_record.where("id", args.id).where("deletedAt", "IS", null).one(),
      );

      if (!record) throw new Error("Shared record editing is not permitted");

      if (tx.location === "server") {
        const membership = await tx.dbTransaction.query(
          "SELECT membership.id FROM sync_workspace_member AS membership JOIN sync_workspace AS workspace ON workspace.id = membership.workspace_identifier WHERE workspace.id = $1 AND membership.user_identifier = $2 AND membership.deleted_at IS NULL AND workspace.deleted_at IS NULL AND membership.role IN ('editor', 'owner') FOR SHARE OF membership, workspace",
          [record.workspaceIdentifier, ctx.userIdentifier],
        );

        if (![...membership].length) throw new Error("Shared record editing is not permitted");
      }

      await tx.mutate.shared_record.update(args);
    },
  ),
});
