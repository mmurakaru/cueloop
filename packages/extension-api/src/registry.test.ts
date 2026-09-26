import { describe, expect, test } from "bun:test";
import { Registry } from "./registry";
import type { Thread } from "@cueloop/schema";

const SESSION: Thread = {
  schemaVersion: "1",
  id: "ses_x",
  workspace: { repoRoot: "/repo", branch: "main" },
  artifact: { type: "plan", content: "# Plan\n", meta: {} },
  revisions: [],
  annotations: [],
  message: null,
  status: "pending",
  createdAt: "2026-01-01T00:00:00.000Z",
};

describe("Registry", () => {
  test("captures each extension's exporters, attributed by name", async () => {
    // Arrange
    const registry = new Registry();

    // Act
    await registry.load("obsidian", (api) => {
      api.registerExporter("obsidian", async () => ({ success: true, path: "/vault/note.md" }));
    });
    await registry.load("bear", (api) => {
      api.registerExporter("bear", async () => ({ success: true }));
    });

    // Assert
    expect(registry.extensions.map((extension) => extension.name)).toEqual(["obsidian", "bear"]);
    const obsidian = registry.extensions[0]!.exporters.get("obsidian")!;

    expect(await obsidian(SESSION)).toEqual({ success: true, path: "/vault/note.md" });
  });

  test("a throwing factory is contained, not fatal", async () => {
    // Arrange
    const registry = new Registry();

    // Act
    const record = await registry.load("broken", () => {
      throw new Error("boom");
    });

    // Assert
    expect(record.errors).toEqual(["boom"]);
    expect(record.exporters.size).toBe(0);
    expect(registry.extensions.length).toBe(1);
  });

  test("a failed factory discards VCS adapters and exporters registered before it threw", async () => {
    const registry = new Registry();
    const record = await registry.load("broken-vcs", (api) => {
      api.registerExporter("draft", async () => ({ success: true }));
      api.registerVcsAdapter({
        apiVersion: 1,
        id: "example.sapling",
        detect: async () => "/repo",
        captureWorkingDiff: async () => ({ patch: "", files: [] }),
        listChanges: async () => [],
        listFiles: async () => [],
      });
      throw new Error("incomplete extension");
    });

    expect(record.errors).toEqual(["incomplete extension"]);
    expect(record.exporters.size).toBe(0);
    expect(record.vcsAdapters.size).toBe(0);
  });

  test("VCS IDs cannot replace built-in or previously registered adapters", async () => {
    const registry = new Registry();
    const adapter = {
      apiVersion: 1 as const,
      id: "example.sapling",
      detect: async () => "/repo",
      captureWorkingDiff: async () => ({ patch: "", files: [] }),
      listChanges: async () => [],
      listFiles: async () => [],
    };

    await registry.load("first", (api) => api.registerVcsAdapter(adapter));
    const duplicate = await registry.load("second", (api) => api.registerVcsAdapter(adapter));
    const builtin = await registry.load("third", (api) =>
      api.registerVcsAdapter({ ...adapter, id: "git" }),
    );

    expect(duplicate.errors).toEqual(["Invalid or duplicate VCS adapter ID: example.sapling"]);
    expect(builtin.errors).toEqual(["Invalid or duplicate VCS adapter ID: git"]);
    expect(registry.extensions[0]!.vcsAdapters.has("example.sapling")).toBe(true);
  });
});
