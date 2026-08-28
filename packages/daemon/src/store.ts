/**
 * Session persistence: one JSON document per session, every write
 * through a temp file + atomic rename so a crash mid-write can never leave
 * a corrupt record. Recovery is a read-only scan; records that fail to
 * parse are skipped and reported, never deleted.
 */

import { mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { ReviewSession } from "@cueloop/schema";
import { validateSessionRecord } from "./validate";
import { sessionsDir } from "./paths";

export interface RecoveryReport {
  recovered: string[];
  skipped: { file: string; error: string }[];
}

export class SessionStore {
  private sessions = new Map<string, ReviewSession>();
  private readonly dir: string;

  constructor(home: string) {
    this.dir = sessionsDir(home);
    mkdirSync(this.dir, { recursive: true });
  }

  /** Read-only scan of the state directory; called once on boot. */
  recover(): RecoveryReport {
    const report: RecoveryReport = { recovered: [], skipped: [] };

    for (const file of readdirSync(this.dir)) {
      if (!file.endsWith(".json")) continue;
      try {
        const raw = readFileSync(join(this.dir, file), "utf8");
        const parsed = validateSessionRecord(JSON.parse(raw));

        if (!parsed.ok) throw new Error(`invalid record - ${parsed.error}`);
        const session = parsed.value as ReviewSession;

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
    return [...this.sessions.values()].sort((left, right) =>
      left.createdAt.localeCompare(right.createdAt),
    );
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
