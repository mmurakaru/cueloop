import {
  sharedExecutionMutatorDefinitions,
  sharedExecutionQueryDefinitions,
} from "./shared-execution.ts";
import { defineMutatorsWithType, defineQueriesWithType } from "@cueloop/sync/schema";
import { sharedRecordSchema, sharedRecordMutators, sharedRecordQueries } from "./shared-record.ts";
import {
  sharedCommentMutatorDefinitions,
  sharedCommentQueryDefinitions,
} from "./shared-comment.ts";

import { sharedTextMutatorDefinitions, sharedTextQueryDefinitions } from "./shared-text.ts";

export { sharedExecutionOperations } from "./shared-execution.ts";
export { sharedTextOperations } from "./shared-text.ts";
export { sharedCommentOperations } from "./shared-comment.ts";
export const sharedWorkspaceMutators = defineMutatorsWithType<typeof sharedRecordSchema>()(
  sharedRecordMutators,
  {
    ...sharedCommentMutatorDefinitions,
    ...sharedTextMutatorDefinitions,
    ...sharedExecutionMutatorDefinitions,
  },
);
export const sharedWorkspaceQueries = defineQueriesWithType<typeof sharedRecordSchema>()(
  sharedRecordQueries,
  {
    ...sharedCommentQueryDefinitions,
    ...sharedTextQueryDefinitions,
    ...sharedExecutionQueryDefinitions,
  },
);
