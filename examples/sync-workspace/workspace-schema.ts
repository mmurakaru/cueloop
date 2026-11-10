import { syncExecutionTable } from "@cueloop/sync/execution/schema";
import { createSchema, number, relationships, string, table } from "@cueloop/sync/schema";

const sharedRecord = table("shared_record")
  .columns({
    id: string(),
    workspaceIdentifier: string().from("workspace_identifier"),
    content: string(),
    textState: string().optional().from("text_state"),
    textRevision: number().from("text_revision"),
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
const sharedComment = table("shared_comment")
  .columns({
    id: string(),
    workspaceIdentifier: string().from("workspace_identifier"),
    recordIdentifier: string().from("record_identifier"),
    authorIdentifier: string().from("author_identifier"),
    body: string(),
    revision: number(),
    createdAt: number().from("created_at"),
    updatedAt: number().from("updated_at"),
    deletedAt: number().optional().from("deleted_at"),
  })
  .primaryKey("id");

const sharedTextRevision = table("shared_text_revision")
  .columns({
    id: string(),
    workspaceIdentifier: string().from("workspace_identifier"),
    recordIdentifier: string().from("record_identifier"),
    actorIdentifier: string().from("actor_identifier"),
    parentIdentifier: string().optional().from("parent_identifier"),
    revision: number(),
    content: string(),
    createdAt: number().from("created_at"),
    updatedAt: number().from("updated_at"),
    deletedAt: number().optional().from("deleted_at"),
  })
  .primaryKey("id");
const textEditRelationships = relationships(sharedTextRevision, ({ many, one }) => ({
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
  record: one({
    sourceField: ["recordIdentifier", "workspaceIdentifier"],
    destField: ["id", "workspaceIdentifier"],
    destSchema: sharedRecord,
  }),
}));

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

const commentRelationships = relationships(sharedComment, ({ many, one }) => ({
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
  record: one({
    sourceField: ["recordIdentifier", "workspaceIdentifier"],
    destField: ["id", "workspaceIdentifier"],
    destSchema: sharedRecord,
  }),
}));

const executionRelationships = relationships(syncExecutionTable, ({ many, one }) => ({
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
  tables: [
    sharedRecord,
    syncWorkspace,
    syncWorkspaceMember,
    sharedComment,
    sharedTextRevision,
    syncExecutionTable,
  ],
  relationships: [
    recordRelationships,
    commentRelationships,
    textEditRelationships,
    executionRelationships,
  ],
  enableLegacyQueries: false,
  enableLegacyMutators: false,
});
