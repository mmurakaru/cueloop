/**
 * Share ids and the two usernames the gateway routes on. An id is `p_` plus 8
 * url-safe base62 chars (~47 bits), rejection-sampled so every id is equally
 * likely - unguessable is the whole security model for an anonymous-read store
 * (ADR 0004). The gateway mints ids, never the client: entropy must not depend
 * on code anyone can patch.
 */

import { randomBytes } from "node:crypto";

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
const ID_LENGTH = 8;
/** Largest multiple of 62 that fits in a byte; above it, reject to avoid bias. */
const UNBIASED_CEILING = 248;

export const SHARE_PREFIX = "p_";
/** Re-exported so gateway callers get the upload username from one contract. */
export { SHARE_UPLOAD_USER } from "@cueloop/daemon/share-blob";

/** Mint an unguessable share id. */
export function mintShareId(): string {
  let body = "";

  while (body.length < ID_LENGTH) {
    for (const byte of randomBytes(ID_LENGTH * 2)) {
      if (byte >= UNBIASED_CEILING) continue;
      body += ALPHABET[byte % ALPHABET.length];
      if (body.length === ID_LENGTH) break;
    }
  }

  return SHARE_PREFIX + body;
}

/** True when a username is a well-formed share id (a view request). */
export function isShareId(value: string): boolean {
  if (!value.startsWith(SHARE_PREFIX)) return false;
  const body = value.slice(SHARE_PREFIX.length);

  return body.length === ID_LENGTH && [...body].every((char) => ALPHABET.includes(char));
}
