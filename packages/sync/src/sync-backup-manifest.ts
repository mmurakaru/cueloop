import * as v from "valibot";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { SyncAuthorityIdentitySchema } from "./sync-authority-protocol.ts";

export const SyncMigrationDigestSchema = v.strictObject({
  identity: v.pipe(v.string(), v.minLength(1), v.maxLength(200)),
  digest: v.pipe(v.string(), v.regex(/^[0-9a-f]{64}$/)),
});
export const SyncBackupManifestSchema = v.strictObject({
  format: v.literal("cueloop-sync-postgresql"),
  version: v.literal(1),
  authority: SyncAuthorityIdentitySchema,
  schemaRevision: v.literal(1),
  serverVersion: v.pipe(v.number(), v.integer(), v.minValue(180000)),
  snapshotStartedAt: v.pipe(v.string(), v.isoTimestamp()),
  schemas: v.pipe(v.array(v.pipe(v.string(), v.regex(/^[a-z_][a-z0-9_]*$/))), v.minLength(1)),
  migrations: v.array(SyncMigrationDigestSchema),
  archiveDigest: v.pipe(v.string(), v.regex(/^[0-9a-f]{64}$/)),
});

export type SyncBackupManifest = v.InferOutput<typeof SyncBackupManifestSchema>;

export async function digestSyncBackupArchive(path: string): Promise<string> {
  const hash = createHash("sha256");

  for await (const bytes of createReadStream(path)) hash.update(bytes);

  return hash.digest("hex");
}
