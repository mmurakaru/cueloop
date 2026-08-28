/**
 * The contribution registry: an extension factory runs against a captured
 * API, and its exporter registrations land as plain data attributed to that
 * extension. One broken extension never takes the host down.
 */

import type { Exporter, ExtensionAPI, ExtensionFactory } from "./types";

export interface ExtensionRecord {
  name: string;
  exporters: Map<string, Exporter>;
  errors: string[];
}

export class Registry {
  readonly extensions: ExtensionRecord[] = [];

  /** Run one extension factory, capturing its registrations. */
  async load(name: string, factory: ExtensionFactory): Promise<ExtensionRecord> {
    const record: ExtensionRecord = { name, exporters: new Map(), errors: [] };
    const api: ExtensionAPI = {
      registerExporter(exporterName, exporter) {
        record.exporters.set(exporterName, exporter);
      },
    };

    try {
      await factory(api);
    } catch (err) {
      record.errors.push(err instanceof Error ? err.message : String(err));
    }
    this.extensions.push(record);

    return record;
  }
}
