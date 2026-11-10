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
});

export type { SyncThreadConnection } from "./sync-thread-connection";

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
    mkdirSync(this.threadDirectory(thread.id), { mode: 0o700 });
    syncDirectory(this.root);
    writeSyncThreadFile(
      join(this.threadDirectory(thread.id), "projection.json"),
      JSON.stringify(v.parse(ProjectionSchema, { version: options.version ?? 0, thread })),
    );
    writeSyncThreadFile(join(this.threadDirectory(thread.id), "import.json"), options.upload);
    writeSyncThreadFile(this.manifestPath(thread.id), JSON.stringify(manifest));
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

  projectionVersion(threadIdentifier: string): number {
    return v.parse(
      ProjectionSchema,
      JSON.parse(
        readFileSync(join(this.threadDirectory(threadIdentifier), "projection.json"), "utf8"),
      ),
    ).version;
  }

  project(options: { thread: Thread; version: number }): void {
    if (!this.isFenced(options.thread.id))
      throw new Error("Sync Thread projection requires a durable authority fence");

    const projection = v.parse(ProjectionSchema, options);
    const path = join(this.threadDirectory(options.thread.id), "projection.json");
    const previous = v.parse(ProjectionSchema, JSON.parse(readFileSync(path, "utf8")));

    if (projection.version < previous.version)
      throw new Error("Sync Thread cannot install an older authority projection");

    writeSyncThreadFile(path, JSON.stringify(projection));
    const manifest = this.read(options.thread.id);

    writeSyncThreadFile(
      this.manifestPath(options.thread.id),
      JSON.stringify({ ...manifest, phase: "remote" }),
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
