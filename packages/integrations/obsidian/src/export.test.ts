import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ReviewSession } from "@cueloop/schema";
import { Registry } from "@cueloop/extension-api";
import { OBSIDIAN_DEFAULTS, exportSession, shouldExport, type ObsidianConfig } from "./export";
import { createObsidianExtension } from "./extension";
import { frontmatter } from "./frontmatter";

const NOW = new Date("2026-08-07T12:34:56.000Z");

function resolvedSession(overrides: Partial<ReviewSession> = {}): ReviewSession {
  return {
    schemaVersion: "1",
    id: "s_test1",
    workspace: { repoRoot: "/repo", branch: "main" },
    artifact: {
      type: "plan",
      content: "# Migration Plan\n\nMove the store.\n",
      meta: { title: "Migration Plan" },
    },
    revisions: [
      {
        revision: 1,
        content: "# Migration Plan\n\nMove the store.\n",
        submittedAt: NOW.toISOString(),
      },
    ],
    annotations: [],
    verdict: { kind: "approve", summary: "ship it", feedback: "", resolvedAt: NOW.toISOString() },
    status: "resolved",
    createdAt: NOW.toISOString(),
    ...overrides,
  };
}

let vault: string;

beforeEach(() => {
  vault = mkdtempSync(join(tmpdir(), "cueloop-obsidian-vault-"));
});
afterEach(() => {
  rmSync(vault, { recursive: true, force: true });
});

function config(overrides: Partial<ObsidianConfig> = {}): ObsidianConfig {
  return { ...OBSIDIAN_DEFAULTS, vault, ...overrides };
}

describe("exportSession", () => {
  test("writes the final plan with frontmatter into vault/folder", () => {
    // Arrange
    const session = resolvedSession();

    // Act
    const result = exportSession(session, config(), NOW);

    // Assert
    expect(result.success).toBe(true);
    expect(result.path).toBe(join(vault, "cueloop", "2026-08-07 - Migration Plan.md"));
    const written = readFileSync(result.path!, "utf8");

    expect(written).toBe(`${frontmatter(session, NOW)}\n\n# Migration Plan\n\nMove the store.\n`);
    expect(written).toContain("created: 2026-08-07T12:34:56.000Z");
    expect(written).toContain("source: cueloop");
    expect(written).toContain("session: s_test1");
    expect(written).toContain("verdict: approve");
  });

  test("the working copy wins over the submitted content", () => {
    // Arrange
    const session = resolvedSession({
      workingCopy: "# Migration Plan\n\nMove the store carefully.\n",
    });

    // Act
    const result = exportSession(session, config(), NOW);

    // Assert
    expect(readFileSync(result.path!, "utf8")).toContain("Move the store carefully.");
  });

  test("never overwrites: collisions get counting suffixes", () => {
    // Arrange
    const session = resolvedSession();

    // Act
    const first = exportSession(session, config(), NOW);
    const second = exportSession(session, config(), NOW);
    const third = exportSession(session, config(), NOW);

    // Assert
    expect(second.path).toBe(join(vault, "cueloop", "2026-08-07 - Migration Plan 2.md"));
    expect(third.path).toBe(join(vault, "cueloop", "2026-08-07 - Migration Plan 3.md"));
    expect(existsSync(first.path!)).toBe(true);
  });

  test("no vault configured and none detected fails without writing", () => {
    // Arrange
    const emptyConfigPath = join(vault, "obsidian.json");

    // Act
    const result = exportSession(
      resolvedSession(),
      config({ vault: undefined, obsidianConfigPath: emptyConfigPath }),
      NOW,
    );

    // Assert
    expect(result.success).toBe(false);
    expect(result.error).toContain("no Obsidian vault");
  });

  test("a configured vault path that does not exist fails", () => {
    // Act
    const result = exportSession(resolvedSession(), config({ vault: join(vault, "missing") }), NOW);

    // Assert
    expect(result.success).toBe(false);
    expect(result.error).toContain("vault not found");
  });

  test("falls back to the first auto-detected vault", () => {
    // Arrange
    const detected = join(vault, "detected-vault");

    mkdirSync(detected);
    const obsidianJson = join(vault, "obsidian.json");

    writeFileSync(obsidianJson, JSON.stringify({ vaults: { v1: { path: detected } } }));

    // Act
    const result = exportSession(
      resolvedSession(),
      config({ vault: undefined, obsidianConfigPath: obsidianJson }),
      NOW,
    );

    // Assert
    expect(result.success).toBe(true);
    expect(result.path).toBe(join(detected, "cueloop", "2026-08-07 - Migration Plan.md"));
  });
});

describe("obsidian extension", () => {
  test("registers the exporter through the extension API and exports a resolved session", async () => {
    // Arrange
    const registry = new Registry();

    // Act
    const record = await registry.load("obsidian", createObsidianExtension(config()));

    // Assert
    expect(record.errors).toEqual([]);
    const exporter = record.exporters.get("obsidian");

    expect(exporter).toBeDefined();

    // Act
    const result = await exporter!(resolvedSession());

    // Assert
    expect(result.success).toBe(true);
    expect(existsSync(result.path!)).toBe(true);
  });
});

describe("shouldExport", () => {
  test("approve exports only approvals", () => {
    expect(shouldExport("approve", "approve")).toBe(true);
    expect(shouldExport("approve", "request_changes")).toBe(false);
    expect(shouldExport("approve", "comment")).toBe(false);
  });

  test("resolve exports any verdict", () => {
    expect(shouldExport("resolve", "approve")).toBe(true);
    expect(shouldExport("resolve", "request_changes")).toBe(true);
    expect(shouldExport("resolve", "comment")).toBe(true);
  });

  test("manual never auto-exports", () => {
    expect(shouldExport("manual", "approve")).toBe(false);
    expect(shouldExport("manual", "request_changes")).toBe(false);
  });
});
