/** Retention: the cleanup period defaults to 30, honors [cleanup] period_days, and prune drops only the sessions and reports past the window. */

import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ReviewSession, SessionStatus } from "@cueloop/schema";
import { SessionStore } from "./store";
import { reportsDir } from "./paths";
import {
  DEFAULT_CLEANUP_PERIOD_DAYS,
  LATEST_REPORT_FILENAME,
  isExpired,
  parseRefineState,
  pruneExpiredReports,
  pruneExpiredSessions,
  resolveCleanupPeriodDays,
} from "./retention";

const DAY_MS = 24 * 60 * 60 * 1000;
const NOW_MS = Date.parse("2026-08-26T00:00:00Z");

function tempDir(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

function daysAgo(days: number): string {
  return new Date(NOW_MS - days * DAY_MS).toISOString();
}

function session(id: string, createdAt: string, status: SessionStatus = "resolved"): ReviewSession {
  return {
    schemaVersion: "1",
    id,
    workspace: { repoRoot: "/repo", branch: "main" },
    artifact: { type: "plan", content: "", meta: {} },
    revisions: [],
    annotations: [],
    verdict: null,
    status,
    createdAt,
  };
}

describe("resolveCleanupPeriodDays", () => {
  test("defaults to 30 when no config file is present", () => {
    // Arrange
    const missing = join(tempDir("cueloop-retention-"), "config.toml");

    // Act
    const days = resolveCleanupPeriodDays({ CUELOOP_CONFIG: missing } as NodeJS.ProcessEnv);

    // Assert
    expect(days).toBe(DEFAULT_CLEANUP_PERIOD_DAYS);
  });

  test("honors [cleanup] period_days", () => {
    // Arrange
    const path = join(tempDir("cueloop-retention-"), "config.toml");
    writeFileSync(path, "[cleanup]\nperiod_days = 7\n");

    // Act
    const days = resolveCleanupPeriodDays({ CUELOOP_CONFIG: path } as NodeJS.ProcessEnv);

    // Assert
    expect(days).toBe(7);
  });

  test("falls back to the default when the value is not a number", () => {
    // Arrange
    const path = join(tempDir("cueloop-retention-"), "config.toml");
    writeFileSync(path, '[cleanup]\nperiod_days = "soon"\n');

    // Act
    const days = resolveCleanupPeriodDays({ CUELOOP_CONFIG: path } as NodeJS.ProcessEnv);

    // Assert
    expect(days).toBe(DEFAULT_CLEANUP_PERIOD_DAYS);
  });
});

describe("parseRefineState", () => {
  test("reads the analyzed fingerprint map", () => {
    // Assert
    expect([...parseRefineState({ analyzed: { ses_a: "1:2:x" } })]).toEqual([["ses_a", "1:2:x"]]);
  });

  test("returns an empty map for the legacy or malformed shape", () => {
    // Assert
    expect(parseRefineState({ seenSessionIds: ["ses_a"] }).size).toBe(0);
    expect(parseRefineState({ analyzed: { ses_a: 5 } }).size).toBe(0);
    expect(parseRefineState(null).size).toBe(0);
  });
});

describe("isExpired", () => {
  test("is true past the window and false inside it", () => {
    // Assert
    expect(isExpired(daysAgo(40), 30, NOW_MS)).toBe(true);
    expect(isExpired(daysAgo(10), 30, NOW_MS)).toBe(false);
  });

  test("a period of zero disables expiry", () => {
    // Assert
    expect(isExpired(daysAgo(999), 0, NOW_MS)).toBe(false);
  });
});

describe("pruneExpiredSessions", () => {
  test("deletes resolved sessions past the window and keeps recent ones", () => {
    // Arrange
    const home = tempDir("cueloop-retention-home-");
    const store = new SessionStore(home);
    store.upsert(session("ses_old", daysAgo(40)));
    store.upsert(session("ses_new", daysAgo(2)));

    // Act
    const pruned = pruneExpiredSessions(store, 30, NOW_MS);

    // Assert
    expect(pruned).toEqual(["ses_old"]);
    expect(store.get("ses_old")).toBeUndefined();
    expect(store.get("ses_new")).toBeDefined();
  });

  test("never deletes an active pending session however old", () => {
    // Arrange
    const home = tempDir("cueloop-retention-home-");
    const store = new SessionStore(home);
    store.upsert(session("ses_active", daysAgo(400), "pending"));

    // Act
    const pruned = pruneExpiredSessions(store, 30, NOW_MS);

    // Assert
    expect(pruned).toEqual([]);
    expect(store.get("ses_active")).toBeDefined();
  });

  test("a period of zero prunes nothing", () => {
    // Arrange
    const home = tempDir("cueloop-retention-home-");
    const store = new SessionStore(home);
    store.upsert(session("ses_old", daysAgo(999)));

    // Act
    const pruned = pruneExpiredSessions(store, 0, NOW_MS);

    // Assert
    expect(pruned).toEqual([]);
    expect(store.get("ses_old")).toBeDefined();
  });
});

describe("pruneExpiredReports", () => {
  test("removes timestamped reports past the window but keeps the latest report", () => {
    // Arrange
    const home = tempDir("cueloop-retention-home-");
    const directory = reportsDir(home);
    mkdirSync(directory, { recursive: true });
    const latest = join(directory, LATEST_REPORT_FILENAME);
    const stale = join(directory, "refine-2026-06-01T00-00-00-000Z.md");
    const fresh = join(directory, "refine-2026-08-25T00-00-00-000Z.md");
    for (const path of [latest, stale, fresh]) writeFileSync(path, "report");
    const staleSeconds = (NOW_MS - 60 * DAY_MS) / 1000;
    utimesSync(stale, staleSeconds, staleSeconds);

    // Act
    const pruned = pruneExpiredReports(directory, 30, NOW_MS);

    // Assert
    expect(pruned).toEqual(["refine-2026-06-01T00-00-00-000Z.md"]);
  });
});
