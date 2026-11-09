import { defineMutatorsWithType, defineQueriesWithType } from "@cueloop/sync/schema";
import { sharedRecordSchema, sharedRecordMutators, sharedRecordQueries } from "./shared-record.ts";
import {
  sharedCommentMutatorDefinitions,
  sharedCommentQueryDefinitions,
} from "./shared-comment.ts";

import { sharedTextMutatorDefinitions, sharedTextQueryDefinitions } from "./shared-text.ts";

export { sharedTextOperations } from "./shared-text.ts";
export { sharedCommentOperations } from "./shared-comment.ts";
export const sharedWorkspaceMutators = defineMutatorsWithType<typeof sharedRecordSchema>()(
  sharedRecordMutators,
  { ...sharedCommentMutatorDefinitions, ...sharedTextMutatorDefinitions },
);
export const sharedWorkspaceQueries = defineQueriesWithType<typeof sharedRecordSchema>()(
  sharedRecordQueries,
  { ...sharedCommentQueryDefinitions, ...sharedTextQueryDefinitions },
);
