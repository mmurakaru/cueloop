import { createBuilder, defineMutatorWithType, defineQueryWithType } from "@cueloop/sync/schema";
import { defineSyncOperation } from "@cueloop/sync/operations";
import * as v from "valibot";
import { sharedRecordSchema } from "./workspace-schema.ts";
import type { SharedRecordContext } from "./shared-record.ts";

const identifier = v.pipe(v.string(), v.uuid());
const body = v.pipe(v.string(), v.minLength(1), v.maxLength(100000));
const revision = v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(2147483646));
const builder = createBuilder(sharedRecordSchema);
const defineCommentQuery = defineQueryWithType<typeof sharedRecordSchema, SharedRecordContext>();
const defineCommentMutator = defineMutatorWithType<
  typeof sharedRecordSchema,
  SharedRecordContext
>();

export const sharedCommentOperations = {
  add: defineSyncOperation({
    name: "comment.add",
    version: 1,
    arguments: v.strictObject({ recordIdentifier: identifier, body }),
  }),
  edit: defineSyncOperation({
    name: "comment.edit",
    version: 1,
    arguments: v.strictObject({ commentIdentifier: identifier, expectedRevision: revision, body }),
  }),
  remove: defineSyncOperation({
    name: "comment.remove",
    version: 1,
    arguments: v.strictObject({ commentIdentifier: identifier, expectedRevision: revision }),
  }),
};

export const sharedCommentQueryDefinitions = {
  comments: defineCommentQuery(
    v.strictObject({
      workspaceIdentifier: identifier,
      recordIdentifier: identifier,
      pageSize: v.optional(v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(100)), 50),
      cursor: v.optional(v.object({ createdAt: v.number(), id: identifier })),
    }),
    ({ args, ctx }) => {
      let query = builder.shared_comment
        .where("workspaceIdentifier", args.workspaceIdentifier)
        .where("recordIdentifier", args.recordIdentifier)
        .where("deletedAt", "IS", null)
        .whereExists("workspace", (workspace) => workspace.where("deletedAt", "IS", null))
        .whereExists("record", (record) => record.where("deletedAt", "IS", null))
        .whereExists("memberships", (membership) =>
          membership.where("userIdentifier", ctx.userIdentifier).where("deletedAt", "IS", null),
        )
        .orderBy("createdAt", "asc")
        .orderBy("id", "asc")
        .limit(args.pageSize);

      if (args.cursor) query = query.start(args.cursor);

      return query;
    },
  ),
};

export const sharedCommentMutatorDefinitions = {
  comment: {
    add: defineCommentMutator(sharedCommentOperations.add.schema, async ({ tx, args, ctx }) => {
      if (tx.location !== "client")
        throw new Error("Shared comment authority requires its server registry");

      await tx.mutate.shared_comment.insert({
        id: args.operationIdentifier,
        workspaceIdentifier: args.workspaceIdentifier,
        recordIdentifier: args.arguments.recordIdentifier,
        authorIdentifier: ctx.userIdentifier,
        body: args.arguments.body,
        revision: 1,
        createdAt: args.createdAt,
        updatedAt: args.createdAt,
        deletedAt: null,
      });
    }),
    edit: defineCommentMutator(sharedCommentOperations.edit.schema, async ({ tx, args }) => {
      if (tx.location !== "client")
        throw new Error("Shared comment authority requires its server registry");

      const current = await tx.run(
        builder.shared_comment.where("id", args.arguments.commentIdentifier).one(),
      );

      if (!current || current.revision !== args.arguments.expectedRevision) return;

      await tx.mutate.shared_comment.update({
        id: current.id,
        body: args.arguments.body,
        revision: current.revision + 1,
        updatedAt: args.createdAt,
      });
    }),
    remove: defineCommentMutator(sharedCommentOperations.remove.schema, async ({ tx, args }) => {
      if (tx.location !== "client")
        throw new Error("Shared comment authority requires its server registry");

      const current = await tx.run(
        builder.shared_comment.where("id", args.arguments.commentIdentifier).one(),
      );

      if (!current || current.revision !== args.arguments.expectedRevision) return;

      await tx.mutate.shared_comment.update({
        id: current.id,
        revision: current.revision + 1,
        updatedAt: args.createdAt,
        deletedAt: args.createdAt,
      });
    }),
  },
};
