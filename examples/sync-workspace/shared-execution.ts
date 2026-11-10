import * as v from "valibot";
import { createBuilder, defineMutatorWithType, defineQueryWithType } from "@cueloop/sync/schema";
import { defineSyncOperation } from "@cueloop/sync/operations";
import { sharedRecordSchema } from "./workspace-schema.ts";
import type { SharedRecordContext } from "./shared-record.ts";

const identifier = v.pipe(v.string(), v.uuid(), v.toLowerCase());
const builder = createBuilder(sharedRecordSchema);
const defineExecutionMutator = defineMutatorWithType<
  typeof sharedRecordSchema,
  SharedRecordContext
>();
const defineExecutionQuery = defineQueryWithType<typeof sharedRecordSchema, SharedRecordContext>();

export const sharedExecutionOperations = {
  request: defineSyncOperation({
    name: "execution.request",
    version: 1,
    arguments: v.strictObject({
      recordIdentifier: identifier,
      text: v.pipe(v.string(), v.trim(), v.minLength(1), v.maxLength(100000)),
      context: v.optional(v.pipe(v.string(), v.maxLength(100000))),
    }),
  }),
};
export const sharedExecutionMutatorDefinitions = {
  execution: {
    request: defineExecutionMutator(
      sharedExecutionOperations.request.schema,
      async ({ tx: transaction }) => {
        if (transaction.location !== "client")
          throw new Error("Shared execution requires its authoritative registry");
      },
    ),
  },
};
export const sharedExecutionQueryDefinitions = {
  executionRequests: defineExecutionQuery(
    v.strictObject({
      workspaceIdentifier: identifier,
      pageSize: v.optional(v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(100)), 50),
    }),
    ({ args: parameters, ctx: principal }) =>
      builder.sync_execution
        .where("workspaceIdentifier", parameters.workspaceIdentifier)
        .where("deletedAt", "IS", null)
        .whereExists("workspace", (workspace) => workspace.where("deletedAt", "IS", null))
        .whereExists("memberships", (memberships) =>
          memberships
            .where("userIdentifier", principal.userIdentifier)
            .where("deletedAt", "IS", null),
        )
        .orderBy("createdAt", "desc")
        .orderBy("id", "desc")
        .limit(parameters.pageSize),
  ),
};
