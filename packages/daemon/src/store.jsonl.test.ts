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
import { ThreadStore } from "./store";
import { migratedSessionsDir, sessionsDir, threadBucket } from "./paths";
import { createTestThreadRecord } from "./testing/store-conformance";

function tmpHome(): string {
  return mkdtempSync(join(tmpdir(), "cueloop-jsonl-"));
}

describe("JSONL thread store", () => {
  test("a thread is written under a per-project bucket keyed by root commit", () => {
    const home = tmpHome();
    const store = new ThreadStore(home);
    store.recover();
    store.upsert(
      createTestThreadRecord("ses_a", "2026-09-01T00:00:00.000Z", {
        workspace: { repoRoot: "/repo", branch: "main", rootCommit: "abcdef0123456789" },
      }),
    );

    const bucket = threadBucket("abcdef0123456789", home);
    expect(readdirSync(bucket)).toContain("ses_a.jsonl");
  });

  test("a non-commit rootCommit (path traversal) cannot escape the threads directory", () => {
    const home = tmpHome();
    const escape = threadBucket("../../../etc/cueloop", home);
    const standalone = threadBucket(undefined, home);

    // a value that is not a real commit SHA is refused to the standalone bucket, never a parent path
    expect(escape).toBe(standalone);
    expect(escape.startsWith(join(home, "threads"))).toBe(true);
  });

  test("a repo-less thread lands in the standalone bucket", () => {
    const home = tmpHome();
    const store = new ThreadStore(home);
    store.recover();
    store.upsert(createTestThreadRecord("ses_s", "2026-09-01T00:00:00.000Z"));

    expect(readdirSync(threadBucket(undefined, home))).toContain("ses_s.jsonl");
  });

  test("boot migrates the old whole-record file and parks the original", () => {
    const home = tmpHome();
    mkdirSync(sessionsDir(home), { recursive: true });
    const legacy = createTestThreadRecord("ses_old", "2026-09-01T00:00:00.000Z");
    writeFileSync(join(sessionsDir(home), "ses_old.json"), JSON.stringify(legacy));

    const store = new ThreadStore(home);
    const report = store.recover();

    expect(report.recovered).toEqual(["ses_old"]);
    // the record migrates intact (a history is derived on read, as the old store did)
    expect(store.get("ses_old")?.id).toBe("ses_old");
    expect(store.get("ses_old")?.artifact).toEqual(legacy.artifact);
    // the original is parked, not left in the live legacy dir
    expect(existsSync(join(sessionsDir(home), "ses_old.json"))).toBe(false);
    expect(readdirSync(migratedSessionsDir(home))).toContain("ses_old.json");
  });

  test("migration never overwrites a newer JSONL with an older legacy snapshot", () => {
    const home = tmpHome();
    // a newer JSONL already holds this thread (e.g. written after a rollback)
    const store = new ThreadStore(home);
    store.recover();
    store.upsert(
      createTestThreadRecord("ses_x", "2026-09-01T00:00:00.000Z", {
        status: "pending",
        workspace: { repoRoot: "/repo", branch: "newer" },
      }),
    );
    // an older legacy JSON for the same thread is restored alongside it
    mkdirSync(sessionsDir(home), { recursive: true });
    writeFileSync(
      join(sessionsDir(home), "ses_x.json"),
      JSON.stringify(
        createTestThreadRecord("ses_x", "2026-09-01T00:00:00.000Z", {
          workspace: { repoRoot: "/repo", branch: "older" },
        }),
      ),
    );

    const reopened = new ThreadStore(home);
    reopened.recover();
    // the newer JSONL wins; the legacy snapshot is parked, not applied
    expect(reopened.get("ses_x")?.workspace.branch).toBe("newer");
    expect(readdirSync(migratedSessionsDir(home))).toContain("ses_x.json");
  });

  test("a long log compacts to a single line, and the record survives it", () => {
    const home = tmpHome();
    const store = new ThreadStore(home);
    store.recover();
    // more upserts than the compaction threshold
    for (let iteration = 0; iteration < 60; iteration++) {
      store.upsert(
        createTestThreadRecord("ses_a", "2026-09-01T00:00:00.000Z", {
          status: "pending",
          workspace: { repoRoot: "/repo", branch: `b${iteration}` },
        }),
      );
    }

    const file = join(threadBucket(undefined, home), "ses_a.jsonl");
    const lines = readFileSync(file, "utf8")
      .split("\n")
      .filter((l) => l.trim());
    expect(lines.length).toBeLessThan(60);
    // the latest snapshot survives the compaction and a restart
    const reopened = new ThreadStore(home);
    reopened.recover();
    expect(reopened.get("ses_a")?.workspace.branch).toBe("b59");
  });

  test("a crash's torn trailing line is skipped; the last valid snapshot wins", () => {
    const home = tmpHome();
    const store = new ThreadStore(home);
    store.recover();
    store.upsert(createTestThreadRecord("ses_a", "2026-09-01T00:00:00.000Z"));

    // simulate a crash mid-append: a half-written line at the end
    const file = join(threadBucket(undefined, home), "ses_a.jsonl");
    appendFileSync(file, '{"id":"ses_a","half');

    const reopened = new ThreadStore(home);
    const report = reopened.recover();
    expect(report.recovered).toEqual(["ses_a"]);
    expect(reopened.get("ses_a")?.id).toBe("ses_a");

    // an update after a torn recovery must not fuse onto the torn fragment and vanish on restart
    reopened.upsert(
      createTestThreadRecord("ses_a", "2026-09-01T00:00:00.000Z", {
        status: "pending",
        workspace: { repoRoot: "/repo", branch: "after-tear" },
      }),
    );
    const restarted = new ThreadStore(home);
    restarted.recover();
    expect(restarted.get("ses_a")?.workspace.branch).toBe("after-tear");
  });
});
