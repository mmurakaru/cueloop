import { describe, expect, test } from "bun:test";
import { OBSIDIAN_DEFAULTS } from "@cueloop/integration-obsidian";
import { loadBundledExporters } from "./integrations";
import type { IntegrationsConfig } from "./config";

function integrations(overrides: Partial<typeof OBSIDIAN_DEFAULTS> = {}): IntegrationsConfig {
  return { obsidian: { ...OBSIDIAN_DEFAULTS, ...overrides } };
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
    const onApprove = (await loadBundledExporters(integrations({ exportOn: "approve" })))[0]!;

    // Assert
    expect(onApprove.runsOn("approve")).toBeTrue();
    expect(onApprove.runsOn("request_changes")).toBeFalse();

    // Arrange
    const onResolve = (await loadBundledExporters(integrations({ exportOn: "resolve" })))[0]!;

    // Assert
    expect(onResolve.runsOn("approve")).toBeTrue();
    expect(onResolve.runsOn("request_changes")).toBeTrue();

    // Arrange
    const manual = (await loadBundledExporters(integrations({ exportOn: "manual" })))[0]!;

    // Assert
    expect(manual.runsOn("approve")).toBeFalse();
    expect(manual.runsOn("request_changes")).toBeFalse();
  });
});
