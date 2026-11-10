import * as v from "valibot";
import { SyncVersionSevenIdentifierSchema } from "./sync-identifiers.ts";

export const SyncAuthorityIdentitySchema = v.object({
  authorityIdentifier: v.pipe(SyncVersionSevenIdentifierSchema, v.brand("SyncAuthorityIdentifier")),
  generation: v.pipe(SyncVersionSevenIdentifierSchema, v.brand("SyncAuthorityGeneration")),
});

export type SyncAuthorityIdentity = v.InferOutput<typeof SyncAuthorityIdentitySchema>;

export const SyncWorkspaceAuthoritySchema = v.strictObject({
  ...SyncAuthorityIdentitySchema.entries,
  workspaceIdentifier: v.pipe(v.string(), v.uuid(), v.toLowerCase()),
  workspaceGeneration: v.pipe(
    SyncVersionSevenIdentifierSchema,
    v.brand("SyncWorkspaceAuthorityGeneration"),
  ),
});

export type SyncWorkspaceAuthority = v.InferOutput<typeof SyncWorkspaceAuthoritySchema>;

/** A missing old-generation receipt cannot establish whether the request committed outside the restored snapshot. */
export class SyncAuthorityRecoveryRequired extends Error {
  constructor() {
    super(
      "Sync authority recovery is required; this operation's outcome is outside the recovered boundary",
    );
    this.name = "SyncAuthorityRecoveryRequired";
  }
}

export class SyncAuthorityFenced extends Error {
  constructor() {
    super("Sync authority is fenced or requires activation");
    this.name = "SyncAuthorityFenced";
  }
}
