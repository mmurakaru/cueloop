import {
  createBuilder,
  createSchema,
  defineMutatorsWithType,
  defineMutatorWithType,
  defineQueriesWithType,
  defineQueryWithType,
  number,
  string,
  table,
} from "@rocicorp/zero";
import * as v from "valibot";

const sharedRecord = table("shared_record")
  .columns({
    id: string(),
    content: string(),
    createdAt: number().from("created_at"),
    updatedAt: number().from("updated_at"),
    deletedAt: number().optional().from("deleted_at"),
  })
  .primaryKey("id");

export const sharedRecordSchema = createSchema({
  tables: [sharedRecord],
  enableLegacyQueries: false,
  enableLegacyMutators: false,
});

export interface SharedRecordContext {
  canEdit: boolean;
}

const builder = createBuilder(sharedRecordSchema);
const defineRecordQuery = defineQueryWithType<typeof sharedRecordSchema, SharedRecordContext>();
const defineRecordMutator = defineMutatorWithType<typeof sharedRecordSchema, SharedRecordContext>();

export const sharedRecordQueries = defineQueriesWithType<typeof sharedRecordSchema>()({
  records: defineRecordQuery(() =>
    builder.shared_record
      .where("deletedAt", "IS", null)
      .orderBy("createdAt", "desc")
      .orderBy("id", "asc"),
  ),
});

export const sharedRecordMutators = defineMutatorsWithType<typeof sharedRecordSchema>()({
  edit: defineRecordMutator(
    v.object({
      id: v.pipe(v.string(), v.uuid()),
      content: v.pipe(v.string(), v.maxLength(100000)),
    }),
    async ({ tx, args, ctx }) => {
      if (!ctx.canEdit) throw new Error("Shared record editing is not permitted");

      await tx.mutate.shared_record.update(args);
    },
  ),
});
