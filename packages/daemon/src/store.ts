/**
 * Thread persistence: one append-only JSONL log per thread, under a per-project bucket keyed by the
 * repo's durable root commit (a shared bucket for repo-less threads). Each mutation appends a
 * snapshot line and the last valid line wins, so a crash's torn tail is simply skipped on read; the
 * log is compacted to one line on the first write, once it grows long, and when the thread resolves.
 * Boot migrates the old whole-record JSON files into this layout and parks the originals. Records
 * that fail to parse are skipped and reported, never deleted; records from before histories existed
 * are given one on read.
 *
 * `ThreadRepository` is the contract every adapter satisfies; the conformance
 * suite in ./testing/store-conformance.ts pins it for the file store and the
 * in-memory store alike.
 */

import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { historyFromLinear, type Thread } from "@cueloop/schema";
import { migratedSessionsDir, sessionsDir, threadBucket, threadsDir } from "./paths";
import { validateThreadRecord } from "./validate";

/** A thread's log is rewritten to a single snapshot line once it grows past this many, so an
 *  active thread's file never bloats unbounded while writes stay cheap appends in between. */
const COMPACT_THRESHOLD = 40;

export interface RecoveryReport {
  recovered: string[];
  skipped: { file: string; error: string }[];
}

/** What the daemon needs from session storage. */
export interface ThreadRepository {
  /** Load what is stored; called once on boot. */
  recover(): RecoveryReport;
  get(id: string): Thread | undefined;
  /** Every session, oldest first. */
  list(): Thread[];
  upsert(session: Thread): void;
  /** True when a session was removed. */
  delete(id: string): boolean;
}

/**
 * A record as it is read: a history is derived for records written without
 * one. A record with no revision has no head to derive from and keeps
 * reading without a history - migration never loses a record.
 */
export function withHistory(session: Thread): Thread {
  if (session.history || session.revisions.length === 0) return session;

  return { ...session, history: historyFromLinear(session) };
}

/** Records in the order `list()` promises: oldest first. */
function oldestFirst(sessions: Iterable<Thread>): Thread[] {
  return [...sessions].sort((left, right) => left.createdAt.localeCompare(right.createdAt));
}

export class ThreadStore implements ThreadRepository {
  private sessions = new Map<string, Thread>();
  /** id -> its JSONL path (the bucket depends on the record's root commit, so it is tracked). */
  private files = new Map<string, string>();
  /** id -> lines in its log, so upsert knows when to compact instead of append. */
  private lineCounts = new Map<string, number>();

  constructor(private readonly home: string) {
    mkdirSync(threadsDir(home), { recursive: true });
    // the legacy dir is where a pre-upgrade daemon wrote; ensure it exists so its scan is uniform
    mkdirSync(sessionsDir(home), { recursive: true });
  }

  recover(): RecoveryReport {
    const report: RecoveryReport = { recovered: [], skipped: [] };

    this.migrateLegacy(report);
    const root = threadsDir(this.home);

    for (const bucket of readdirSync(root)) {
      const bucketPath = join(root, bucket);

      if (!statSync(bucketPath).isDirectory()) continue;
      for (const file of readdirSync(bucketPath)) {
        if (!file.endsWith(".jsonl")) continue;
        const filePath = join(bucketPath, file);
        try {
          const { session, lines, torn } = readThread(filePath);

          this.sessions.set(session.id, session);
          this.files.set(session.id, filePath);
          this.lineCounts.set(session.id, lines);
          report.recovered.push(session.id);
          // a torn trailing fragment would fuse with the next append and lose that update, so rewrite
          // the log to a single clean snapshot line now that the last valid record is in hand
          if (torn) this.writeWhole(session);
        } catch (error) {
          report.skipped.push({
            file,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
    }

    return report;
  }

  /** One-time upgrade: write each old whole-record JSON as a thread log and park the original, so
   *  the threads scan below recovers it. Invalid records are reported and left in place, never lost. */
  private migrateLegacy(report: RecoveryReport): void {
    const legacyDir = sessionsDir(this.home);

    if (!existsSync(legacyDir)) return;
    const parked = migratedSessionsDir(this.home);

    for (const file of readdirSync(legacyDir)) {
      if (!file.endsWith(".json")) continue;
      const legacyPath = join(legacyDir, file);
      let session: Thread;

      try {
        const parsed = validateThreadRecord(JSON.parse(readFileSync(legacyPath, "utf8")));

        if (!parsed.ok) throw new Error(`invalid record - ${parsed.error}`);
        session = withHistory(parsed.value);
      } catch (error) {
        report.skipped.push({
          file,
          error: error instanceof Error ? error.message : String(error),
        });
        continue;
      }
      const targetPath = join(
        threadBucket(session.workspace.rootCommit, this.home),
        `${session.id}.jsonl`,
      );

      // after a rollback a newer JSONL can already hold this thread; never overwrite it with the
      // older legacy snapshot - the existing log stays authoritative and the threads scan recovers it
      if (!existsSync(targetPath)) this.writeWhole(session);
      // forget the in-memory tracking migration seeded: the threads scan is the one recovery path
      this.files.delete(session.id);
      this.lineCounts.delete(session.id);
      mkdirSync(parked, { recursive: true });
      renameSync(legacyPath, join(parked, file));
    }
  }

  /** Rewrite the thread to a single snapshot line, atomically - the first write and every compaction. */
  private writeWhole(session: Thread): void {
    const filePath =
      this.files.get(session.id) ??
      join(threadBucket(session.workspace.rootCommit, this.home), `${session.id}.jsonl`);

    mkdirSync(dirname(filePath), { recursive: true });
    const tempPath = filePath + ".tmp";

    writeFileSync(tempPath, JSON.stringify(session) + "\n");
    renameSync(tempPath, filePath);
    this.files.set(session.id, filePath);
    this.lineCounts.set(session.id, 1);
  }

  get(id: string): Thread | undefined {
    return this.sessions.get(id);
  }

  list(): Thread[] {
    return oldestFirst(this.sessions.values());
  }

  upsert(session: Thread): void {
    this.sessions.set(session.id, session);
    const filePath = this.files.get(session.id);
    const lines = this.lineCounts.get(session.id) ?? 0;

    // the first write, an over-long log, and a resolved (now immutable) thread all compact to one
    // line; every other mutation is a cheap append that a torn tail on crash simply drops on read
    if (filePath === undefined || lines >= COMPACT_THRESHOLD || session.status === "resolved") {
      this.writeWhole(session);

      return;
    }
    appendFileSync(filePath, JSON.stringify(session) + "\n");
    this.lineCounts.set(session.id, lines + 1);
  }

  delete(id: string): boolean {
    if (!this.sessions.delete(id)) return false;
    const filePath = this.files.get(id);

    if (filePath) rmSync(filePath, { force: true });
    this.files.delete(id);
    this.lineCounts.delete(id);

    return true;
  }
}

/**
 * Read a thread log: the last valid snapshot line wins, so a crash's torn trailing line is skipped.
 * `torn` is true when that winning line was not the last physical line - the caller rewrites the log
 * so the next append starts on a clean boundary instead of fusing onto the torn fragment.
 */
function readThread(filePath: string) {
  const allLines = readFileSync(filePath, "utf8")
    .split("\n")
    .filter((line) => line.trim().length > 0);

  for (let index = allLines.length - 1; index >= 0; index--) {
    let record: unknown;

    try {
      record = JSON.parse(allLines[index]!);
    } catch {
      continue;
    }
    const parsed = validateThreadRecord(record);

    if (parsed.ok) {
      return {
        session: withHistory(parsed.value),
        lines: allLines.length,
        torn: index !== allLines.length - 1,
      };
    }
  }
  throw new Error("no valid record line");
}

/**
 * The in-memory adapter: the same contract with nothing on disk. `seed` stands
 * in for what a file store finds on recovery, so validation and migration are
 * exercised the same way.
 */
export class MemoryThreadStore implements ThreadRepository {
  private sessions = new Map<string, Thread>();

  constructor(private readonly seed: unknown[] = []) {}

  recover(): RecoveryReport {
    const report: RecoveryReport = { recovered: [], skipped: [] };

    this.seed.forEach((record, index) => {
      const parsed = validateThreadRecord(record);

      if (!parsed.ok) {
        report.skipped.push({ file: `seed[${index}]`, error: `invalid record - ${parsed.error}` });

        return;
      }
      const session = withHistory(parsed.value);

      this.sessions.set(session.id, session);
      report.recovered.push(session.id);
    });

    return report;
  }

  get(id: string): Thread | undefined {
    return this.sessions.get(id);
  }

  list(): Thread[] {
    return oldestFirst(this.sessions.values());
  }

  upsert(session: Thread): void {
    this.sessions.set(session.id, session);
  }

  delete(id: string): boolean {
    return this.sessions.delete(id);
  }
}
