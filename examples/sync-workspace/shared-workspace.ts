import { defineMutatorsWithType, defineQueriesWithType } from "@cueloop/sync/schema";
import { sharedRecordSchema, sharedRecordMutators, sharedRecordQueries } from "./shared-record.ts";
import {
  sharedCommentMutatorDefinitions,
  sharedCommentQueryDefinitions,
} from "./shared-comment.ts";

export { sharedCommentOperations } from "./shared-comment.ts";
export const sharedWorkspaceMutators = defineMutatorsWithType<typeof sharedRecordSchema>()(
  sharedRecordMutators,
  sharedCommentMutatorDefinitions,
);
export const sharedWorkspaceQueries = defineQueriesWithType<typeof sharedRecordSchema>()(
  sharedRecordQueries,
  sharedCommentQueryDefinitions,
);
