/**
 * Bundled integration wiring: composes the configured integrations into
 * generic exporters plus their run policy, so the session controller depends
 * only on the extension seam, never on an integration's own config type. This
 * and config.ts are the only client modules that name a concrete integration.
 */

import { Registry, type Exporter } from "@cueloop/extension-api";
import { createObsidianExtension, shouldExport } from "@cueloop/integration-obsidian";
import type { VerdictKind } from "@cueloop/schema";
import type { IntegrationsConfig } from "./config";

/** An exporter plus the policy deciding which verdicts trigger it. */
export interface BundledExporter {
  name: string;
  run: Exporter;
  runsOn(verdict: VerdictKind): boolean;
}

/** Load the bundled integrations from config as generic exporters. */
export async function loadBundledExporters(integrations: IntegrationsConfig): Promise<BundledExporter[]> {
  const registry = new Registry();
  const obsidian = integrations.obsidian;
  const record = await registry.load("obsidian", createObsidianExtension(obsidian));
  const run = record.exporters.get("obsidian");
  if (!run) return [];
  return [{ name: "obsidian", run, runsOn: (verdict) => shouldExport(obsidian.exportOn, verdict) }];
}
