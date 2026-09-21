import { describe, expect, test } from "bun:test";
import { OBSIDIAN_DEFAULTS } from "@cueloop/integration-obsidian";
import { loadBundledExporters } from "./integrations";
import type { IntegrationsConfig } from "./config";

function integrations(overrides: Partial<typeof OBSIDIAN_DEFAULTS> = {}): IntegrationsConfig {
  return { obsidian: { ...OBSIDIAN_DEFAULTS, ...overrides }, herdr: { threadSurface: "tab" } };
}

describe("loadBundledExporters", () => {
  test("composes the obsidian integration into one named exporter", async () => {
    // Act
    const exporters = await loadBundledExporters(integrations());

    // Assert
    expect(exporters.map((exporter) => exporter.name)).toEqual(["obsidian"]);
  });

  test("runsOn mirrors the configured export policy", async () => {
    // Arrange
    const onApprove = (await loadBundledExporters(integrations({ exportOn: "approved" })))[0]!;

    // Assert
    expect(onApprove.runsOn("approved")).toBeTrue();
    expect(onApprove.runsOn("changes_requested")).toBeFalse();

    // Arrange
    const onMessage = (await loadBundledExporters(integrations({ exportOn: "message" })))[0]!;

    // Assert
    expect(onMessage.runsOn("approved")).toBeTrue();
    expect(onMessage.runsOn("changes_requested")).toBeTrue();

    // Arrange
    const manual = (await loadBundledExporters(integrations({ exportOn: "manual" })))[0]!;

    // Assert
    expect(manual.runsOn("approved")).toBeFalse();
    expect(manual.runsOn("changes_requested")).toBeFalse();
  });
});
