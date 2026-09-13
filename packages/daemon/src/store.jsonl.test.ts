/**
 * The JSONL thread store's own behaviors, beyond the shared repository contract: per-project bucket
 * layout keyed by root commit, one-time migration of the old whole-record files, compaction of a
 * long log, and a crash's torn trailing line being skipped on read.
 */

import { describe, expect, test } from "bun:test";
import {
  mkdtempSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
  appendFileSync,
  existsSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SessionStore } from "./store";
import { migratedSessionsDir, sessionsDir, threadBucket } from "./paths";
import { createTestSessionRecord } from "./testing/store-conformance";

function tmpHome(): string {
  return mkdtempSync(join(tmpdir(), "cueloop-jsonl-"));
}

describe("JSONL thread store", () => {
  test("a thread is written under a per-project bucket keyed by root commit", () => {
    const home = tmpHome();
    const store = new SessionStore(home);
    store.recover();
    store.upsert(
      createTestSessionRecord("ses_a", "2026-09-01T00:00:00.000Z", {
        workspace: { repoRoot: "/repo", branch: "main", rootCommit: "abcdef0123456789" },
      }),
    );

    const bucket = threadBucket("abcdef0123456789", home);
    expect(readdirSync(bucket)).toContain("ses_a.jsonl");
  });

  test("a repo-less thread lands in the standalone bucket", () => {
    const home = tmpHome();
    const store = new SessionStore(home);
    store.recover();
    store.upsert(createTestSessionRecord("ses_s", "2026-09-01T00:00:00.000Z"));

    expect(readdirSync(threadBucket(undefined, home))).toContain("ses_s.jsonl");
  });

  test("boot migrates the old whole-record file and parks the original", () => {
    const home = tmpHome();
    mkdirSync(sessionsDir(home), { recursive: true });
    const legacy = createTestSessionRecord("ses_old", "2026-09-01T00:00:00.000Z");
    writeFileSync(join(sessionsDir(home), "ses_old.json"), JSON.stringify(legacy));

    const store = new SessionStore(home);
    const report = store.recover();

    expect(report.recovered).toEqual(["ses_old"]);
    // the record migrates intact (a history is derived on read, as the old store did)
    expect(store.get("ses_old")?.id).toBe("ses_old");
    expect(store.get("ses_old")?.artifact).toEqual(legacy.artifact);
    // the original is parked, not left in the live legacy dir
    expect(existsSync(join(sessionsDir(home), "ses_old.json"))).toBe(false);
    expect(readdirSync(migratedSessionsDir(home))).toContain("ses_old.json");
  });

  test("a long log compacts to a single line, and the record survives it", () => {
    const home = tmpHome();
    const store = new SessionStore(home);
    store.recover();
    // more upserts than the compaction threshold
    for (let n = 0; n < 60; n++) {
      store.upsert(
        createTestSessionRecord("ses_a", "2026-09-01T00:00:00.000Z", {
          status: "pending",
          workspace: { repoRoot: "/repo", branch: `b${n}` },
        }),
      );
    }

    const file = join(threadBucket(undefined, home), "ses_a.jsonl");
    const lines = readFileSync(file, "utf8")
      .split("\n")
      .filter((l) => l.trim());
    expect(lines.length).toBeLessThan(60);
    // the latest snapshot survives the compaction and a restart
    const reopened = new SessionStore(home);
    reopened.recover();
    expect(reopened.get("ses_a")?.workspace.branch).toBe("b59");
  });

  test("a crash's torn trailing line is skipped; the last valid snapshot wins", () => {
    const home = tmpHome();
    const store = new SessionStore(home);
    store.recover();
    store.upsert(createTestSessionRecord("ses_a", "2026-09-01T00:00:00.000Z"));

    // simulate a crash mid-append: a half-written line at the end
    const file = join(threadBucket(undefined, home), "ses_a.jsonl");
    appendFileSync(file, '{"id":"ses_a","half');

    const reopened = new SessionStore(home);
    const report = reopened.recover();
    expect(report.recovered).toEqual(["ses_a"]);
    expect(reopened.get("ses_a")?.id).toBe("ses_a");
  });
});
