import { defineMutatorsWithType } from "@cueloop/sync/schema";
import { sharedRecordSchema } from "./workspace-schema.ts";
import { sharedWorkspaceMutators } from "./shared-workspace.ts";
import { sharedCommentServerMutatorDefinitions } from "./shared-comment-authority.ts";
import { sharedTextServerMutatorDefinitions } from "./shared-text-authority.ts";

export const sharedWorkspaceServerMutators = defineMutatorsWithType<typeof sharedRecordSchema>()(
  sharedWorkspaceMutators,
  { ...sharedCommentServerMutatorDefinitions, ...sharedTextServerMutatorDefinitions },
);
