import { json, number, string, table } from "./sync-schema.ts";

/** Public execution observations exclude owner claim credentials and fencing metadata. */
export const syncExecutionTable = table("sync_execution")
  .columns({
    id: string(),
    workspaceIdentifier: string().from("workspace_identifier"),
    targetIdentifier: string().from("target_identifier"),
    requesterIdentifier: string().from("requester_identifier"),
    action: string(),
    input: json(),
    status: string(),
    observationReference: string().optional().from("observation_reference"),
    errorMessage: string().optional().from("error_message"),
    createdAt: number().from("created_at"),
    updatedAt: number().from("updated_at"),
    deletedAt: number().optional().from("deleted_at"),
  })
  .primaryKey("id");
