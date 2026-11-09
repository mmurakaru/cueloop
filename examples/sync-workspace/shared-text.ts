import { createBuilder, defineMutatorWithType, defineQueryWithType } from "@cueloop/sync/schema";
import { defineSyncOperation } from "@cueloop/sync/operations";
import {
  mergeSyncTextUpdate,
  readSyncTextState,
  SyncTextStateSchema,
  SyncTextUpdateSchema,
  type SyncTextSnapshot,
} from "@cueloop/sync/text";
import * as v from "valibot";
import { sharedRecordSchema } from "./workspace-schema.ts";
import type { SharedRecordContext } from "./shared-record.ts";

const identifier = v.pipe(v.string(), v.uuid(), v.toLowerCase());
const builder = createBuilder(sharedRecordSchema);
const defineTextMutator = defineMutatorWithType<typeof sharedRecordSchema, SharedRecordContext>();
const defineTextQuery = defineQueryWithType<typeof sharedRecordSchema, SharedRecordContext>();

export const sharedTextOperations = {
  initialize: defineSyncOperation({
    name: "text.initialize",
    version: 1,
    arguments: v.strictObject({ recordIdentifier: identifier, state: SyncTextStateSchema }),
  }),
  edit: defineSyncOperation({
    name: "text.edit",
    version: 1,
    arguments: v.strictObject({ recordIdentifier: identifier, update: SyncTextUpdateSchema }),
  }),
};

export const sharedTextMutatorDefinitions = {
  text: {
    initialize: defineTextMutator(sharedTextOperations.initialize.schema, async ({ tx, args }) => {
      if (tx.location !== "client")
        throw new Error("Shared text authority requires its server registry");

      const record = await tx.run(
        builder.shared_record
          .where("id", args.arguments.recordIdentifier)
          .where("workspaceIdentifier", args.workspaceIdentifier)
          .one(),
      );

      if (!record || record.textState !== null) return;

      const initial = readSyncTextState(args.arguments.state);

      if (initial.text !== record.content)
        throw new Error("Shared text initialization must preserve the current content");

      await tx.mutate.shared_record.update({
        id: record.id,
        textState: initial.state,
        textRevision: 0,
      });
    }),
    edit: defineTextMutator(sharedTextOperations.edit.schema, async ({ tx, args }) => {
      if (tx.location !== "client")
        throw new Error("Shared text authority requires its server registry");

      const record = await tx.run(
        builder.shared_record
          .where("id", args.arguments.recordIdentifier)
          .where("workspaceIdentifier", args.workspaceIdentifier)
          .one(),
      );

      if (!record?.textState) return;

      let next: SyncTextSnapshot;

      try {
        next = mergeSyncTextUpdate({ state: record.textState, update: args.arguments.update });
      } catch {
        // A selective replica can lack dependencies; the authority validates the full update.
        return;
      }

      await tx.mutate.shared_record.update({
        id: record.id,
        content: next.text,
        textState: next.state,
        textRevision: record.textRevision + 1,
      });
    }),
  },
};

export const sharedTextQueryDefinitions = {
  textDocument: defineTextQuery(
    v.strictObject({ workspaceIdentifier: identifier, recordIdentifier: identifier }),
    ({ args, ctx }) =>
      builder.shared_record
        .where("id", args.recordIdentifier)
        .where("workspaceIdentifier", args.workspaceIdentifier)
        .where("deletedAt", "IS", null)
        .whereExists("workspace", (workspace) => workspace.where("deletedAt", "IS", null))
        .whereExists("memberships", (membership) =>
          membership.where("userIdentifier", ctx.userIdentifier).where("deletedAt", "IS", null),
        )
        .related("memberships", (membership) =>
          membership.where("userIdentifier", ctx.userIdentifier).where("deletedAt", "IS", null),
        )
        .one(),
  ),
  textHistory: defineTextQuery(
    v.strictObject({
      workspaceIdentifier: identifier,
      recordIdentifier: identifier,
      pageSize: v.optional(v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(100)), 50),
      beforeRevision: v.optional(v.pipe(v.number(), v.integer(), v.minValue(0))),
    }),
    ({ args, ctx }) => {
      let query = builder.shared_text_revision
        .where("workspaceIdentifier", args.workspaceIdentifier)
        .where("recordIdentifier", args.recordIdentifier)
        .where("deletedAt", "IS", null)
        .whereExists("workspace", (workspace) => workspace.where("deletedAt", "IS", null))
        .whereExists("record", (record) => record.where("deletedAt", "IS", null))
        .whereExists("memberships", (membership) =>
          membership.where("userIdentifier", ctx.userIdentifier).where("deletedAt", "IS", null),
        )
        .orderBy("revision", "desc")
        .orderBy("id", "asc")
        .limit(args.pageSize);

      if (args.beforeRevision !== undefined)
        query = query.where("revision", "<", args.beforeRevision);

      return query;
    },
  ),
};

export const SharedTextStateRequestSchema = v.strictObject({
  workspaceIdentifier: v.pipe(v.string(), v.uuid()),
  recordIdentifier: v.pipe(v.string(), v.uuid()),
});
export const SharedTextStateResponseSchema = v.object({
  id: v.pipe(v.string(), v.uuid()),
  workspaceIdentifier: v.pipe(v.string(), v.uuid()),
  content: v.string(),
  textState: v.nullable(v.string()),
  textRevision: v.number(),
  role: v.picklist(["viewer", "editor", "owner"]),
});
