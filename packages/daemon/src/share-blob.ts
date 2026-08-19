/**
 * The share-blob wire format: how a ReviewSession travels from `cueloop share`
 * to the gateway. The planner's CLI packs (this is the only thing it can do -
 * it holds no encryption key); the gateway unpacks, then encrypts for R2.
 *
 * Format is gzip(JSON). Unpack is the untrusted boundary - the bytes come off
 * an SSH channel from anyone who can reach the `share` user - so it caps the
 * decompressed size (a decompression-bomb guard) and runs the same record
 * validator the daemon store uses, never trusting the shape.
 */

import { gzipSync, gunzipSync } from "node:zlib";
import type { ReviewSession } from "@cueloop/schema";
import { validateSessionRecord } from "./validate";

/** Decompressed ceiling for one shared session (ADR 0004's payload cap). */
export const MAX_BLOB_BYTES = 1024 * 1024;

/** The SSH username `cueloop share` connects as to upload; the gateway routes on it. */
export const SHARE_UPLOAD_USER = "share";

/** Where shares live, in one place: the client uploads here, the gateway prints it. */
export const DEFAULT_SHARE_HOST = "cueloop.dev";
export const DEFAULT_SHARE_PORT = 22;

/** Serialise + compress a session for upload. */
export function packSessionBlob(session: ReviewSession): Buffer {
  return gzipSync(Buffer.from(JSON.stringify(session), "utf8"));
}

/** Decompress + validate an uploaded blob, or throw a precise reason. */
export function unpackSessionBlob(bytes: Uint8Array): ReviewSession {
  let json: string;
  try {
    json = gunzipSync(bytes, { maxOutputLength: MAX_BLOB_BYTES }).toString("utf8");
  } catch (err) {
    throw new Error(`blob is not valid gzip or exceeds ${MAX_BLOB_BYTES} bytes: ${err instanceof Error ? err.message : String(err)}`, { cause: err });
  }
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    throw new Error("blob is not valid JSON");
  }
  const parsed = validateSessionRecord(raw);
  if (!parsed.ok) throw new Error(`blob is not a valid session: ${parsed.error}`);
  return parsed.value as ReviewSession;
}
