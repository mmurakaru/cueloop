/**
 * Where sealed blobs live, keyed by share id. R2 in production, an in-memory
 * map in tests and the local demo. The gateway only ever puts and gets by id -
 * no listing, no enumeration - which is exactly the anonymous-write bound
 * ADR 0004 asks for. Blobs are already ciphertext before they reach here.
 */

import { S3Client } from "bun";

/**
 * How long a shared blob stays reachable, counted from its last write. The
 * gateway enforces this on read so an expired share reads as gone even where an
 * R2 lifecycle rule has not yet swept the object. A write (create or revision)
 * restarts the window, so an actively-used share does not expire under its
 * owner. This is the number the sharing docs advertise; keep the two in step.
 */
export const SHARE_TTL_MS = 30 * 24 * 60 * 60 * 1000;

/** A blob written at `storedAtMs` is expired once `nowMs` reaches the TTL. */
export function isExpired(storedAtMs: number, nowMs: number, ttlMs = SHARE_TTL_MS): boolean {
  return nowMs - storedAtMs >= ttlMs;
}

export interface ShareStore {
  put(id: string, bytes: Uint8Array): Promise<void>;
  /** The stored bytes, or null when no blob exists for that id or it has expired. */
  get(id: string): Promise<Uint8Array | null>;
}

/** "This share changed" notifications, per share id. */
export interface ShareChangeFeed {
  subscribe(id: string, listener: () => void): () => void;
}

/**
 * The store every writer in the gateway goes through, fanning out a change
 * notification per share id after each successful put. Scoped to this
 * process: a viewer or watch stream hears every write this gateway accepts,
 * which is all of them while the gateway runs as one instance.
 */
export class WatchedShareStore implements ShareStore, ShareChangeFeed {
  private readonly listeners = new Map<string, Set<() => void>>();

  constructor(private readonly inner: ShareStore) {}

  get(id: string): Promise<Uint8Array | null> {
    return this.inner.get(id);
  }

  async put(id: string, bytes: Uint8Array): Promise<void> {
    await this.inner.put(id, bytes);
    // listeners run after the put resolves and never fail the write
    for (const listener of this.listeners.get(id) ?? []) queueMicrotask(listener);
  }

  subscribe(id: string, listener: () => void): () => void {
    const set = this.listeners.get(id) ?? new Set();

    set.add(listener);
    this.listeners.set(id, set);

    return () => {
      set.delete(listener);
      if (set.size === 0) this.listeners.delete(id);
    };
  }
}

/** In-process store for tests and `--store memory` local runs. */
export class MemoryShareStore implements ShareStore {
  private readonly blobs = new Map<string, { bytes: Uint8Array; storedAt: number }>();

  /** `now` is injectable so tests can advance the clock past the TTL. */
  constructor(private readonly now: () => number = Date.now) {}

  async put(id: string, bytes: Uint8Array): Promise<void> {
    this.blobs.set(id, { bytes, storedAt: this.now() });
  }

  async get(id: string): Promise<Uint8Array | null> {
    const entry = this.blobs.get(id);

    if (!entry) return null;
    if (isExpired(entry.storedAt, this.now())) {
      this.blobs.delete(id);

      return null;
    }

    return entry.bytes;
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

    try {
      const { lastModified } = await file.stat();

      if (isExpired(lastModified.getTime(), Date.now())) return null;

      return await file.bytes();
    } catch (error) {
      // A missing object reads as gone; a fault on a still-present object stays loud.
      if (await file.exists()) throw error;

      return null;
    }
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
