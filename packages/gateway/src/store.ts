/**
 * Where sealed blobs live, keyed by share id. R2 in production, an in-memory
 * map in tests and the local demo. The gateway only ever puts and gets by id -
 * no listing, no enumeration - which is exactly the anonymous-write bound
 * ADR 0004 asks for. Blobs are already ciphertext before they reach here.
 */

import { S3Client } from "bun";

export interface ShareStore {
  put(id: string, bytes: Uint8Array): Promise<void>;
  /** The stored bytes, or null when no blob exists for that id. */
  get(id: string): Promise<Uint8Array | null>;
}

/** In-process store for tests and `--store memory` local runs. */
export class MemoryShareStore implements ShareStore {
  private readonly blobs = new Map<string, Uint8Array>();

  async put(id: string, bytes: Uint8Array): Promise<void> {
    this.blobs.set(id, bytes);
  }

  async get(id: string): Promise<Uint8Array | null> {
    return this.blobs.get(id) ?? null;
  }
}

/** Cloudflare R2 over the S3 protocol, via Bun's built-in client. */
export class R2ShareStore implements ShareStore {
  private readonly client: S3Client;

  constructor(options: {
    endpoint: string;
    bucket: string;
    accessKeyId: string;
    secretAccessKey: string;
  }) {
    this.client = new S3Client({ ...options, region: "auto" });
  }

  async put(id: string, bytes: Uint8Array): Promise<void> {
    await this.client.file(id).write(bytes);
  }

  async get(id: string): Promise<Uint8Array | null> {
    const file = this.client.file(id);

    if (!(await file.exists())) return null;

    return file.bytes();
  }
}

/**
 * Build the R2 store from the gateway's environment. Kept separate from the
 * class so tests never touch env and the server fails fast with a clear reason
 * when a credential is missing.
 */
export function r2StoreFromEnv(env: NodeJS.ProcessEnv = process.env): R2ShareStore {
  const endpoint = required(env, "CUELOOP_R2_ENDPOINT");
  const accessKeyId = required(env, "CUELOOP_R2_ACCESS_KEY_ID");
  const secretAccessKey = required(env, "CUELOOP_R2_SECRET_ACCESS_KEY");
  const bucket = env.CUELOOP_R2_BUCKET ?? "cueloop-shares";

  return new R2ShareStore({ endpoint, bucket, accessKeyId, secretAccessKey });
}

function required(env: NodeJS.ProcessEnv, key: string): string {
  const value = env[key];

  if (!value) throw new Error(`missing ${key} - the gateway needs R2 credentials to store shares`);

  return value;
}
