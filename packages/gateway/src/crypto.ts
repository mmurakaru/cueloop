/**
 * Blob encryption for R2 at rest. The gateway is the only component that holds
 * a key (ADR 0004's trust-the-gateway model), so all of this runs server-side.
 *
 * One 256-bit master key lives on the VM. Each blob gets its own key derived by
 * HKDF-SHA256 from the master, salted with the share id - so a leaked single
 * key exposes one blob, never the store. Ciphertext is AES-256-GCM: the tag
 * makes decryption fail loudly if a stored byte was flipped. The envelope
 * carries a version so a future format change is a non-event, never a break.
 */

import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "node:crypto";

/** Raw length of the master key and every derived per-blob key. */
export const KEY_BYTES = 32;
/** GCM nonce length; a fresh random nonce is drawn per seal, never reused. */
const NONCE_BYTES = 12;
const ENVELOPE_VERSION = 1;
const HKDF_INFO = Buffer.from("cueloop-share-blob-v1");

/** The on-disk shape R2 stores: version + nonce + ciphertext + auth tag. */
interface Envelope {
  v: number;
  nonce: string;
  ciphertext: string;
  tag: string;
}

/** Per-blob key = HKDF-SHA256(master, salt = share id). */
function deriveBlobKey(master: Buffer, shareId: string): Buffer {
  return Buffer.from(hkdfSync("sha256", master, Buffer.from(shareId), HKDF_INFO, KEY_BYTES));
}

/** Encrypt a blob for a share id; the bytes are ready to PUT to R2. */
export function sealBlob(master: Buffer, shareId: string, plaintext: Uint8Array): Buffer {
  const key = deriveBlobKey(master, shareId);
  const nonce = randomBytes(NONCE_BYTES);
  const cipher = createCipheriv("aes-256-gcm", key, nonce);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const envelope: Envelope = {
    v: ENVELOPE_VERSION,
    nonce: nonce.toString("base64"),
    ciphertext: ciphertext.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
  };

  return Buffer.from(JSON.stringify(envelope), "utf8");
}

/** Decrypt a stored blob; throws if the id is wrong or a byte was tampered. */
export function openBlob(master: Buffer, shareId: string, stored: Uint8Array): Buffer {
  let envelope: Envelope;

  try {
    envelope = JSON.parse(Buffer.from(stored).toString("utf8")) as Envelope;
  } catch {
    throw new Error("stored blob is not a valid envelope");
  }
  if (envelope.v !== ENVELOPE_VERSION)
    throw new Error(`unsupported envelope version ${envelope.v}`);
  const key = deriveBlobKey(master, shareId);
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(envelope.nonce, "base64"));

  decipher.setAuthTag(Buffer.from(envelope.tag, "base64"));

  return Buffer.concat([
    decipher.update(Buffer.from(envelope.ciphertext, "base64")),
    decipher.final(),
  ]);
}

/** Mint a fresh master key for provisioning a new gateway. */
export function generateMasterKey(): Buffer {
  return randomBytes(KEY_BYTES);
}
