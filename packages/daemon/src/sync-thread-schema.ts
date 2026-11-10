import { createSchema, json, number, relationships, string, table } from "@cueloop/sync/schema";

const workspace = table("cueloop_sync_workspace")
  .columns({
    id: string(),
    title: string(),
    createdAt: number().from("created_at"),
    updatedAt: number().from("updated_at"),
    deletedAt: number().optional().from("deleted_at"),
  })
  .primaryKey("id");
const membership = table("cueloop_sync_workspace_member")
  .columns({
    id: string(),
    workspaceIdentifier: string().from("workspace_identifier"),
    actorIdentifier: string().from("actor_identifier"),
    role: string<"viewer" | "editor" | "owner">(),
    createdAt: number().from("created_at"),
    updatedAt: number().from("updated_at"),
    deletedAt: number().optional().from("deleted_at"),
  })
  .primaryKey("id")
  .unique("workspaceIdentifier", "actorIdentifier");
const thread = table("cueloop_sync_thread")
  .columns({
    id: string(),
    workspaceIdentifier: string().from("workspace_identifier"),
    threadIdentifier: string().from("thread_identifier"),
    titlePreview: string().from("title_preview"),
    status: string<"pending" | "resolved">(),
    version: number(),
    threadCreatedAt: number().from("thread_created_at"),
    createdAt: number().from("created_at"),
    updatedAt: number().from("updated_at"),
    deletedAt: number().optional().from("deleted_at"),
  })
  .primaryKey("id")
  .unique("workspaceIdentifier", "threadIdentifier");
const state = table("cueloop_sync_thread_state")
  .columns({
    id: string(),
    workspaceIdentifier: string().from("workspace_identifier"),
    document: json(),
    createdAt: number().from("created_at"),
    updatedAt: number().from("updated_at"),
    deletedAt: number().optional().from("deleted_at"),
  })
  .primaryKey("id");
const document = table("cueloop_sync_thread_document")
  .columns({
    id: string(),
    workspaceIdentifier: string().from("workspace_identifier"),
    document: json(),
    textState: string().optional().from("text_state"),
    textDocumentIdentifier: string().optional().from("text_document_identifier"),
    textRevision: number().from("text_revision"),
    createdAt: number().from("created_at"),
    updatedAt: number().from("updated_at"),
    deletedAt: number().optional().from("deleted_at"),
  })
  .primaryKey("id");
const workspaceRelationships = relationships(workspace, ({ many }) => ({
  memberships: many({
    sourceField: ["id"],
    destField: ["workspaceIdentifier"],
    destSchema: membership,
  }),
}));
const membershipRelationships = relationships(membership, ({ one }) => ({
  workspace: one({
    sourceField: ["workspaceIdentifier"],
    destField: ["id"],
    destSchema: workspace,
  }),
}));
const threadRelationships = relationships(thread, ({ many, one }) => ({
  workspace: one({
    sourceField: ["workspaceIdentifier"],
    destField: ["id"],
    destSchema: workspace,
  }),
  memberships: many({
    sourceField: ["workspaceIdentifier"],
    destField: ["workspaceIdentifier"],
    destSchema: membership,
  }),
}));
const documentRelationships = relationships(document, ({ many, one }) => ({
  thread: one({ sourceField: ["id"], destField: ["id"], destSchema: thread }),
  workspace: one({
    sourceField: ["workspaceIdentifier"],
    destField: ["id"],
    destSchema: workspace,
  }),
  memberships: many({
    sourceField: ["workspaceIdentifier"],
    destField: ["workspaceIdentifier"],
    destSchema: membership,
  }),
}));

const stateRelationships = relationships(state, ({ many, one }) => ({
  thread: one({ sourceField: ["id"], destField: ["id"], destSchema: thread }),
  projection: one({ sourceField: ["id"], destField: ["id"], destSchema: document }),
  workspace: one({
    sourceField: ["workspaceIdentifier"],
    destField: ["id"],
    destSchema: workspace,
  }),
  memberships: many({
    sourceField: ["workspaceIdentifier"],
    destField: ["workspaceIdentifier"],
    destSchema: membership,
  }),
}));

/** Workspace lists subscribe to metadata; opening one Thread subscribes to its separate document. */
export const syncThreadSchema = createSchema({
  tables: [workspace, membership, thread, document, state],
  relationships: [
    workspaceRelationships,
    membershipRelationships,
    threadRelationships,
    documentRelationships,
    stateRelationships,
  ],
});
