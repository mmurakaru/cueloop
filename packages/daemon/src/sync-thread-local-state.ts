import { SyncAuthorityIdentitySchema, type SyncAuthorityIdentity } from "@cueloop/sync/authority";
import { SyncThreadConnectionSchema, type SyncThreadConnection } from "./sync-thread-connection";
import { createHash, randomUUID } from "node:crypto";
import {
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import type { Thread } from "@cueloop/schema";
import * as v from "valibot";
import { ThreadRecordSchema } from "./validate";
import { DaemonError } from "./errors";

const activeSyncHomes = new Set<string>();
const ManifestSchema = v.strictObject({
  threadIdentifier: v.string(),
  phase: v.picklist(["importing", "remote"]),
  connection: SyncThreadConnectionSchema,
});
const ProjectionSchema = v.strictObject({
  version: v.pipe(v.number(), v.safeInteger(), v.minValue(0)),
  thread: ThreadRecordSchema,
  authority: v.optional(SyncAuthorityIdentitySchema),
  heldMessageIdentifiers: v.optional(v.array(v.string()), []),
});

interface SyncThreadProjectionRecord {
  thread: Thread;
  version: number;
  heldMessageIdentifiers: string[];
  authority?: SyncAuthorityIdentity;
}

export interface SyncThreadProjectionOptions {
  authority?: SyncAuthorityIdentity;
  acceptRecovery?: boolean;
}

export type { SyncThreadConnection } from "./sync-thread-connection";

function syncThreadMessageIdentifiers(thread: Thread): string[] {
  const messages =
    thread.history?.entries.flatMap((entry) =>
      entry.type === "message" ? [entry.message.id] : [],
    ) ?? [];

  if (thread.message) messages.push(thread.message.id);

  return messages;
}

function syncDirectory(path: string): void {
  const descriptor = openSync(path, "r");

  try {
    fsyncSync(descriptor);
  } finally {
    closeSync(descriptor);
  }
}

function writeSyncThreadFile(path: string, content: string): void {
  const temporary = `${path}.${randomUUID()}.tmp`;
  const descriptor = openSync(temporary, "wx", 0o600);

  try {
    writeFileSync(descriptor, content);
    fsyncSync(descriptor);
  } finally {
    closeSync(descriptor);
  }

  renameSync(temporary, path);
  syncDirectory(dirname(path));
}

/** The fence directory itself reserves authority even when its journal is missing or corrupt. */
export class SyncThreadLocalState {
  private readonly root: string;

  constructor(home: string) {
    this.root = join(resolve(home), "sync-threads");

    if (existsSync(this.root)) activeSyncHomes.add(this.root);
  }

  private threadDirectory(threadIdentifier: string): string {
    return join(this.root, createHash("sha256").update(threadIdentifier).digest("hex"));
  }

  manifestPath(threadIdentifier: string): string {
    return join(this.threadDirectory(threadIdentifier), "manifest.json");
  }

  hasFences(): boolean {
    return activeSyncHomes.has(this.root);
  }

  isFenced(threadIdentifier: string): boolean {
    return activeSyncHomes.has(this.root) && existsSync(this.threadDirectory(threadIdentifier));
  }

  assertLocalAuthority(threadIdentifier: string): void {
    if (this.isFenced(threadIdentifier))
      throw new DaemonError(
        "sync_authority_required",
        "Sync Thread requires its workspace authority; its local copy is a read-only projection",
      );
  }

  begin(options: {
    thread: Thread;
    connection: SyncThreadConnection;
    upload: string;
    phase?: "importing" | "remote";
    version?: number;
  }): void {
    const manifest = v.parse(ManifestSchema, {
      threadIdentifier: options.thread.id,
      phase: options.phase ?? "importing",
      connection: options.connection,
    });
    const thread = v.parse(ThreadRecordSchema, options.thread);

    this.assertLocalAuthority(thread.id);
    mkdirSync(this.root, { recursive: true, mode: 0o700 });
    syncDirectory(dirname(this.root));
    activeSyncHomes.add(this.root);
    const preparing = `${this.threadDirectory(thread.id)}.preparing.${randomUUID()}`;

    mkdirSync(preparing, { mode: 0o700 });

    try {
      writeSyncThreadFile(
        join(preparing, "projection.json"),
        JSON.stringify(v.parse(ProjectionSchema, { version: options.version ?? 0, thread })),
      );
      writeSyncThreadFile(join(preparing, "import.json"), options.upload);
      writeSyncThreadFile(join(preparing, "manifest.json"), JSON.stringify(manifest));
      renameSync(preparing, this.threadDirectory(thread.id));
      syncDirectory(this.root);
    } catch (cause) {
      rmSync(preparing, { recursive: true, force: true });

      throw cause;
    }
  }

  read(threadIdentifier: string) {
    const manifest = v.parse(
      ManifestSchema,
      JSON.parse(readFileSync(this.manifestPath(threadIdentifier), "utf8")),
    );

    if (manifest.threadIdentifier !== threadIdentifier)
      throw new Error("Sync Thread routing journal identity does not match its fence");

    return manifest;
  }

  readUpload(threadIdentifier: string): string {
    return readFileSync(join(this.threadDirectory(threadIdentifier), "import.json"), "utf8");
  }

  replaceRejectedUpload(threadIdentifier: string, upload: string): void {
    if (this.read(threadIdentifier).phase !== "importing")
      throw new Error("Sync Thread accepted authority cannot start a replacement import");

    writeSyncThreadFile(join(this.threadDirectory(threadIdentifier), "import.json"), upload);
  }

  readProjection(threadIdentifier: string) {
    const projection = v.parse(
      ProjectionSchema,
      JSON.parse(
        readFileSync(join(this.threadDirectory(threadIdentifier), "projection.json"), "utf8"),
      ),
    );

    if (projection.thread.id !== threadIdentifier)
      throw new Error("Sync Thread cached projection identity does not match its fence");

    return projection;
  }

  projectionVersion(threadIdentifier: string): number {
    return this.readProjection(threadIdentifier).version;
  }

  project(options: { thread: Thread; version: number } & SyncThreadProjectionOptions): boolean {
    if (!this.isFenced(options.thread.id))
      throw new Error("Sync Thread projection requires a durable authority fence");

    const path = join(this.threadDirectory(options.thread.id), "projection.json");
    const previous = this.readProjection(options.thread.id);
    const manifest = this.read(options.thread.id);
    const authority = options.authority ?? previous.authority;
    const changedGeneration =
      authority !== undefined &&
      (previous.authority
        ? authority.authorityIdentifier !== previous.authority.authorityIdentifier ||
          authority.generation !== previous.authority.generation
        : manifest.phase === "remote");

    if (changedGeneration && !options.acceptRecovery)
      throw new DaemonError(
        "sync_recovery_required",
        "Sync Thread authority generation changed; resume with --accept-recovery to preserve the previous projection and read the restored snapshot",
      );

    if (!changedGeneration && options.version < previous.version)
      throw new Error("Sync Thread cannot install an older authority projection");

    if (changedGeneration) {
      const archived = JSON.stringify(previous);
      const archives = join(this.threadDirectory(options.thread.id), "recovered-projections");

      mkdirSync(archives, { recursive: true, mode: 0o700 });
      writeSyncThreadFile(
        join(archives, `${createHash("sha256").update(archived).digest("hex")}.json`),
        archived,
      );
    }

    const heldMessageIdentifiers = [
      ...new Set([
        ...previous.heldMessageIdentifiers,
        ...(changedGeneration
          ? [
              ...syncThreadMessageIdentifiers(previous.thread),
              ...syncThreadMessageIdentifiers(options.thread),
            ]
          : []),
      ]),
    ];
    const input: SyncThreadProjectionRecord = {
      thread: options.thread,
      version: options.version,
      heldMessageIdentifiers,
    };

    if (authority) input.authority = authority;

    const projection = v.parse(ProjectionSchema, input);

    writeSyncThreadFile(path, JSON.stringify(projection));
    writeSyncThreadFile(
      this.manifestPath(options.thread.id),
      JSON.stringify({ ...manifest, phase: "remote" }),
    );

    return changedGeneration;
  }

  recoveryArchives(threadIdentifier: string): string[] {
    const directory = join(this.threadDirectory(threadIdentifier), "recovered-projections");

    if (!existsSync(directory)) return [];

    return readdirSync(directory)
      .filter((name) => /^[0-9a-f]{64}\.json$/.test(name))
      .sort()
      .map((name) => join(directory, name));
  }

  isMessageHeld(threadIdentifier: string, messageIdentifier: string): boolean {
    return (
      this.isFenced(threadIdentifier) &&
      this.readProjection(threadIdentifier).heldMessageIdentifiers.includes(messageIdentifier)
    );
  }

  markDeleted(threadIdentifier: string): void {
    if (!this.isFenced(threadIdentifier))
      throw new Error("Sync Thread deletion requires an existing authority fence");

    writeSyncThreadFile(join(this.threadDirectory(threadIdentifier), "deleted.json"), "true");
  }

  projections(): Thread[] {
    if (!activeSyncHomes.has(this.root)) return [];

    const threads: Thread[] = [];

    for (const entry of readdirSync(this.root, { withFileTypes: true })) {
      if (!entry.isDirectory() || !/^[a-f0-9]{64}$/.test(entry.name)) continue;

      if (existsSync(join(this.root, entry.name, "deleted.json"))) continue;

      try {
        const projection = v.parse(
          ProjectionSchema,
          JSON.parse(readFileSync(join(this.root, entry.name, "projection.json"), "utf8")),
        );

        if (this.threadDirectory(projection.thread.id) !== join(this.root, entry.name)) continue;

        threads.push(projection.thread);
      } catch {
        continue;
      }
    }

    return threads;
  }

  park(threadIdentifier: string, path: string): void {
    if (!this.isFenced(threadIdentifier))
      throw new Error("Sync Thread archive requires a durable authority fence");

    const target = join(this.threadDirectory(threadIdentifier), "local.jsonl");

    if (existsSync(target))
      throw new Error(
        "Sync Thread archive already exists; retain the conflicting local file for recovery",
      );

    renameSync(path, target);
    syncDirectory(dirname(path));
    syncDirectory(dirname(target));
  }
}
