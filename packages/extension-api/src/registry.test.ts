import { describe, expect, test } from "bun:test";
import { Registry } from "./registry";
import type { ReviewSession } from "@cueloop/schema";

const SESSION = { id: "ses_x", annotations: [] } as unknown as ReviewSession;

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
});
