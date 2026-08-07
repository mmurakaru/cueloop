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
    revisions: [{ revision: 1, content: "# Migration Plan\n\nMove the store.\n", submittedAt: NOW.toISOString() }],
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
    const session = resolvedSession();
    const result = exportSession(session, config(), NOW);
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
    const session = resolvedSession({ workingCopy: "# Migration Plan\n\nMove the store carefully.\n" });
    const result = exportSession(session, config(), NOW);
    expect(readFileSync(result.path!, "utf8")).toContain("Move the store carefully.");
  });

  test("never overwrites: collisions get counting suffixes", () => {
    const session = resolvedSession();
    const first = exportSession(session, config(), NOW);
    const second = exportSession(session, config(), NOW);
    const third = exportSession(session, config(), NOW);
    expect(second.path).toBe(join(vault, "cueloop", "2026-08-07 - Migration Plan 2.md"));
    expect(third.path).toBe(join(vault, "cueloop", "2026-08-07 - Migration Plan 3.md"));
    expect(existsSync(first.path!)).toBe(true);
  });

  test("no vault configured and none detected fails without writing", () => {
    const emptyConfigPath = join(vault, "obsidian.json");
    const result = exportSession(resolvedSession(), config({ vault: undefined, obsidianConfigPath: emptyConfigPath }), NOW);
    expect(result.success).toBe(false);
    expect(result.error).toContain("no Obsidian vault");
  });

  test("a configured vault path that does not exist fails", () => {
    const result = exportSession(resolvedSession(), config({ vault: join(vault, "missing") }), NOW);
    expect(result.success).toBe(false);
    expect(result.error).toContain("vault not found");
  });

  test("falls back to the first auto-detected vault", () => {
    const detected = join(vault, "detected-vault");
    mkdirSync(detected);
    const obsidianJson = join(vault, "obsidian.json");
    writeFileSync(obsidianJson, JSON.stringify({ vaults: { v1: { path: detected } } }));
    const result = exportSession(resolvedSession(), config({ vault: undefined, obsidianConfigPath: obsidianJson }), NOW);
    expect(result.success).toBe(true);
    expect(result.path).toBe(join(detected, "cueloop", "2026-08-07 - Migration Plan.md"));
  });
});

describe("obsidian extension", () => {
  test("registers the exporter through the extension API and exports a resolved session", async () => {
    const registry = new Registry();
    const record = await registry.load("obsidian", createObsidianExtension(config()));
    expect(record.errors).toEqual([]);
    const exporter = record.exporters.get("obsidian");
    expect(exporter).toBeDefined();
    const result = await exporter!(resolvedSession());
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
