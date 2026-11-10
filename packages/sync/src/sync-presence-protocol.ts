import * as v from "valibot";

const PresenceIdentifierSchema = v.pipe(v.string(), v.uuid(), v.toLowerCase());
const PresenceSequenceSchema = v.pipe(v.number(), v.safeInteger(), v.minValue(1));
const PresencePositionSchema = v.pipe(v.string(), v.minLength(4), v.maxLength(1024));

export const SyncPresenceSelectionSchema = v.strictObject({
  documentIdentifier: PresenceIdentifierSchema,
  anchor: PresencePositionSchema,
  focus: PresencePositionSchema,
});

export const SyncPresenceUpdateSchema = v.strictObject({
  typing: v.optional(v.boolean()),
  selection: v.optional(v.nullable(SyncPresenceSelectionSchema)),
});

export type SyncPresenceSelection = v.InferOutput<typeof SyncPresenceSelectionSchema>;
export const SyncPresenceRequestSchema = v.variant("action", [
  v.strictObject({ action: v.literal("read"), workspaceIdentifier: PresenceIdentifierSchema }),
  v.strictObject({
    action: v.literal("leave"),
    workspaceIdentifier: PresenceIdentifierSchema,
    connectionIdentifier: PresenceIdentifierSchema,
  }),
  v.strictObject({
    action: v.literal("publish"),
    workspaceIdentifier: PresenceIdentifierSchema,
    connectionIdentifier: PresenceIdentifierSchema,
    sequence: PresenceSequenceSchema,
    typing: v.boolean(),
    selection: v.nullable(SyncPresenceSelectionSchema),
  }),
]);
export const SyncPresencePeerSchema = v.object({
  actorIdentifier: v.pipe(v.string(), v.minLength(1), v.maxLength(200)),
  workspaceIdentifier: PresenceIdentifierSchema,
  connectionIdentifier: PresenceIdentifierSchema,
  sequence: PresenceSequenceSchema,
  typing: v.boolean(),
  selection: v.nullable(SyncPresenceSelectionSchema),
  expiresAt: v.pipe(v.number(), v.safeInteger(), v.minValue(0)),
});

export type SyncPresencePeer = v.InferOutput<typeof SyncPresencePeerSchema>;
export const SyncPresenceResponseSchema = v.object({
  peers: v.pipe(v.array(SyncPresencePeerSchema), v.maxLength(100)),
  leaseMilliseconds: v.literal(15000),
});

export const SyncPresenceSnapshotSchema = v.object({
  status: v.picklist(["connecting", "connected", "offline", "forbidden", "closed"]),
  peers: v.pipe(v.array(SyncPresencePeerSchema), v.maxLength(100)),
  error: v.optional(v.string()),
});
