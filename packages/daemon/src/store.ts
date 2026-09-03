/**
 * Session persistence: one JSON record per session, written whole through a
 * temp file and an atomic rename so a crash never leaves a torn file. Recovery
 * is a read-only scan of the state directory; records that fail to parse are
 * skipped and reported, never deleted, and records from before histories
 * existed are given one on read.
 *
 * `SessionRepository` is the contract every adapter satisfies; the conformance
 * suite in ./testing/store-conformance.ts pins it for the file store and the
 * in-memory store alike.
 */

import { mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { historyFromLinear, type ReviewSession } from "@cueloop/schema";
import { sessionsDir } from "./paths";
import { validateSessionRecord } from "./validate";

export interface RecoveryReport {
  recovered: string[];
  skipped: { file: string; error: string }[];
}

/** What the daemon needs from session storage. */
export interface SessionRepository {
  /** Load what is stored; called once on boot. */
  recover(): RecoveryReport;
  get(id: string): ReviewSession | undefined;
  /** Every session, oldest first. */
  list(): ReviewSession[];
  upsert(session: ReviewSession): void;
  /** True when a session was removed. */
  delete(id: string): boolean;
}

/**
 * A record as it is read: a history is derived for records written without
 * one. A record with no revision has no head to derive from and keeps
 * reading without a history - migration never loses a record.
 */
export function withHistory(session: ReviewSession): ReviewSession {
  if (session.history || session.revisions.length === 0) return session;

  return { ...session, history: historyFromLinear(session) };
}

/** Records in the order `list()` promises: oldest first. */
function oldestFirst(sessions: Iterable<ReviewSession>): ReviewSession[] {
  return [...sessions].sort((left, right) => left.createdAt.localeCompare(right.createdAt));
}

export class SessionStore implements SessionRepository {
  private sessions = new Map<string, ReviewSession>();
  private readonly dir: string;

  constructor(home: string) {
    this.dir = sessionsDir(home);
    mkdirSync(this.dir, { recursive: true });
  }

  recover(): RecoveryReport {
    const report: RecoveryReport = { recovered: [], skipped: [] };

    for (const file of readdirSync(this.dir)) {
      if (!file.endsWith(".json")) continue;
      try {
        const raw = readFileSync(join(this.dir, file), "utf8");
        const parsed = validateSessionRecord(JSON.parse(raw));

        if (!parsed.ok) throw new Error(`invalid record - ${parsed.error}`);
        const session = withHistory(parsed.value);

        this.sessions.set(session.id, session);
        report.recovered.push(session.id);
      } catch (err) {
        report.skipped.push({ file, error: err instanceof Error ? err.message : String(err) });
      }
    }

    return report;
  }

  get(id: string): ReviewSession | undefined {
    return this.sessions.get(id);
  }

  list(): ReviewSession[] {
    return oldestFirst(this.sessions.values());
  }

  upsert(session: ReviewSession): void {
    this.sessions.set(session.id, session);
    const path = join(this.dir, `${session.id}.json`);
    const tempPath = path + ".tmp";

    writeFileSync(tempPath, JSON.stringify(session, null, 2));
    renameSync(tempPath, path);
  }

  delete(id: string): boolean {
    if (!this.sessions.delete(id)) return false;
    rmSync(join(this.dir, `${id}.json`), { force: true });

    return true;
  }
}

/**
 * The in-memory adapter: the same contract with nothing on disk. `seed` stands
 * in for what a file store finds on recovery, so validation and migration are
 * exercised the same way.
 */
export class MemorySessionStore implements SessionRepository {
  private sessions = new Map<string, ReviewSession>();

  constructor(private readonly seed: unknown[] = []) {}

  recover(): RecoveryReport {
    const report: RecoveryReport = { recovered: [], skipped: [] };

    this.seed.forEach((record, index) => {
      const parsed = validateSessionRecord(record);

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

  get(id: string): ReviewSession | undefined {
    return this.sessions.get(id);
  }

  list(): ReviewSession[] {
    return oldestFirst(this.sessions.values());
  }

  upsert(session: ReviewSession): void {
    this.sessions.set(session.id, session);
  }

  delete(id: string): boolean {
    return this.sessions.delete(id);
  }
}
