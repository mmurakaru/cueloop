/**
 * The session repository contract as executable cases. Every adapter runs the
 * same suite: what a store returns, in which order, what survives a restart,
 * what a bad record does, and how a record without a history reads.
 *
 * `restart` gives back a fresh adapter over the same persisted state (or the
 * same seed) so recovery is tested through the contract, never past it.
 */

import { describe, expect, test } from "bun:test";
import { SCHEMA_VERSION, type ReviewSession } from "@cueloop/schema";
import type { SessionRepository } from "../store";

export interface StoreHarness {
  /** A fresh, empty adapter that will recover `records` on `recover()`. */
  open: (records: unknown[]) => SessionRepository;
  /** A new adapter over whatever `store` persisted, as after a daemon restart. */
  restart: (store: SessionRepository) => SessionRepository;
}

export function sessionRecord(
  id: string,
  createdAt: string,
  overrides: Partial<ReviewSession> = {},
): ReviewSession {
  return {
    schemaVersion: SCHEMA_VERSION,
    id,
    workspace: { repoRoot: "/repo", branch: "main" },
    artifact: { type: "plan", content: `# ${id}`, meta: {} },
    revisions: [{ revision: 1, content: `# ${id}`, submittedAt: createdAt }],
    annotations: [],
    verdict: null,
    status: "pending",
    createdAt,
    ...overrides,
  };
}

export function runSessionStoreConformance(name: string, harness: StoreHarness): void {
  describe(`${name} - session repository contract`, () => {
    test("a stored session reads back whole and lists oldest first", () => {
      // Arrange
      const store = harness.open([]);

      store.recover();
      const newer = sessionRecord("ses_b", "2026-09-02T00:00:00.000Z");
      const older = sessionRecord("ses_a", "2026-09-01T00:00:00.000Z");

      // Act
      store.upsert(newer);
      store.upsert(older);

      // Assert
      expect(store.get("ses_a")).toEqual(older);
      expect(store.list().map((session) => session.id)).toEqual(["ses_a", "ses_b"]);
      expect(store.get("ses_zzz")).toBeUndefined();
    });

    test("upsert replaces by id and delete reports whether anything was removed", () => {
      // Arrange
      const store = harness.open([]);

      store.recover();
      store.upsert(sessionRecord("ses_a", "2026-09-01T00:00:00.000Z"));

      // Act
      store.upsert(sessionRecord("ses_a", "2026-09-01T00:00:00.000Z", { status: "resolved" }));

      // Assert
      expect(store.list()).toHaveLength(1);
      expect(store.get("ses_a")?.status).toBe("resolved");
      expect(store.delete("ses_a")).toBe(true);
      expect(store.delete("ses_a")).toBe(false);
      expect(store.list()).toEqual([]);
    });

    test("what was upserted survives a restart, deletions included", () => {
      // Arrange
      const store = harness.open([]);

      store.recover();
      store.upsert(sessionRecord("ses_keep", "2026-09-01T00:00:00.000Z"));
      store.upsert(sessionRecord("ses_gone", "2026-09-02T00:00:00.000Z"));
      store.delete("ses_gone");

      // Act
      const reopened = harness.restart(store);
      const report = reopened.recover();

      // Assert
      expect(report.recovered).toEqual(["ses_keep"]);
      expect(reopened.get("ses_keep")?.artifact.content).toBe("# ses_keep");
      expect(reopened.get("ses_gone")).toBeUndefined();
    });

    test("a record without a history reads as a one-branch tree whose head is the artifact", () => {
      // Arrange: written before histories existed, with two revisions and a comment
      const legacy = sessionRecord("ses_old", "2026-09-01T00:00:00.000Z", {
        artifact: { type: "plan", content: "v2", meta: {} },
        revisions: [
          { revision: 1, content: "v1", submittedAt: "2026-09-01T00:00:00.000Z" },
          { revision: 2, content: "v2", submittedAt: "2026-09-01T02:00:00.000Z" },
        ],
        annotations: [
          {
            id: "a1",
            kind: "comment",
            anchor: { quote: "v1", prefix: "", suffix: "" },
            body: "why",
            createdAt: "2026-09-01T01:00:00.000Z",
          },
        ],
      });
      const store = harness.open([legacy]);

      // Act
      const report = store.recover();
      const history = store.get("ses_old")?.history;

      // Assert
      expect(report.recovered).toEqual(["ses_old"]);
      expect(history?.branch).toBe("main");
      expect(history?.entries.map((entry) => entry.type)).toEqual([
        "revision",
        "comment",
        "revision",
      ]);
      expect(history?.entries.at(-1)).toMatchObject({ type: "revision", content: "v2" });
      expect(history?.tips.main).toBe(history?.entries.at(-1)?.id);
    });

    test("a record with no revision still recovers, without a history", () => {
      // Arrange
      const store = harness.open([
        sessionRecord("ses_empty", "2026-09-01T00:00:00.000Z", { revisions: [] }),
      ]);

      // Act
      const report = store.recover();

      // Assert
      expect(report.recovered).toEqual(["ses_empty"]);
      expect(store.get("ses_empty")?.history).toBeUndefined();
    });

    test("a record that already carries a history keeps it untouched", () => {
      // Arrange
      const withTree = sessionRecord("ses_tree", "2026-09-01T00:00:00.000Z", {
        history: {
          entries: [
            {
              id: "root",
              parentId: null,
              type: "revision",
              by: "agent",
              content: "# ses_tree",
              createdAt: "2026-09-01T00:00:00.000Z",
            },
          ],
          tips: { main: "root", ramble: "root" },
          branch: "ramble",
          labels: { root: "start" },
        },
      });
      const store = harness.open([withTree]);

      // Act
      store.recover();

      // Assert
      expect(store.get("ses_tree")?.history).toEqual(withTree.history);
    });

    test("a record that fails validation is skipped and reported, never dropped from the report", () => {
      // Arrange
      const store = harness.open([
        sessionRecord("ses_good", "2026-09-01T00:00:00.000Z"),
        { schemaVersion: SCHEMA_VERSION, id: "ses_bad" },
      ]);

      // Act
      const report = store.recover();

      // Assert
      expect(report.recovered).toEqual(["ses_good"]);
      expect(report.skipped).toHaveLength(1);
      expect(report.skipped[0]!.error).toContain("invalid record");
      expect(store.get("ses_bad")).toBeUndefined();
    });
  });
}
