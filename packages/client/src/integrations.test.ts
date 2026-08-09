import { describe, expect, test } from "bun:test";
import { OBSIDIAN_DEFAULTS } from "@cueloop/integration-obsidian";
import { loadBundledExporters } from "./integrations";
import type { IntegrationsConfig } from "./config";

function integrations(overrides: Partial<typeof OBSIDIAN_DEFAULTS> = {}): IntegrationsConfig {
  return { obsidian: { ...OBSIDIAN_DEFAULTS, ...overrides } };
}

describe("loadBundledExporters", () => {
  test("composes the obsidian integration into one named exporter", async () => {
    const exporters = await loadBundledExporters(integrations());
    expect(exporters.map((exporter) => exporter.name)).toEqual(["obsidian"]);
  });

  test("runsOn mirrors the configured export policy", async () => {
    const onApprove = (await loadBundledExporters(integrations({ exportOn: "approve" })))[0]!;
    expect(onApprove.runsOn("approve")).toBeTrue();
    expect(onApprove.runsOn("request_changes")).toBeFalse();

    const onResolve = (await loadBundledExporters(integrations({ exportOn: "resolve" })))[0]!;
    expect(onResolve.runsOn("approve")).toBeTrue();
    expect(onResolve.runsOn("request_changes")).toBeTrue();

    const manual = (await loadBundledExporters(integrations({ exportOn: "manual" })))[0]!;
    expect(manual.runsOn("approve")).toBeFalse();
    expect(manual.runsOn("request_changes")).toBeFalse();
  });
});
