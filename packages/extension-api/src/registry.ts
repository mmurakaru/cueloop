/**
 * The contribution registry: an extension factory runs against a captured
 * API, and its exporter registrations land as plain data attributed to that
 * extension. One broken extension never takes the host down.
 */

import type { Exporter, ExtensionAPI, ExtensionFactory, VcsAdapter } from "./types";
import * as v from "valibot";

const VcsAdapterSchema = v.object({
  apiVersion: v.literal(1),
  id: v.pipe(v.string(), v.regex(/^[a-z][a-z0-9-]*(?:\.[a-z][a-z0-9-]*)+$/)),
  detect: v.function(),
  captureWorkingDiff: v.function(),
  captureChange: v.optional(v.function()),
  listChanges: v.function(),
  listFiles: v.function(),
});

export interface ExtensionRecord {
  name: string;
  exporters: Map<string, Exporter>;
  vcsAdapters: Map<string, VcsAdapter>;
  errors: string[];
}

export class Registry {
  readonly extensions: ExtensionRecord[] = [];

  /** Run one extension factory, capturing its registrations. */
  async load(name: string, factory: ExtensionFactory): Promise<ExtensionRecord> {
    const record: ExtensionRecord = {
      name,
      exporters: new Map(),
      vcsAdapters: new Map(),
      errors: [],
    };
    const api: ExtensionAPI = {
      registerExporter(exporterName, exporter) {
        record.exporters.set(exporterName, exporter);
      },
      registerVcsAdapter: (adapter) => {
        if (adapter.id === "git" || adapter.id === "jj")
          throw new Error(`Invalid or duplicate VCS adapter ID: ${adapter.id}`);
        const parsed = v.safeParse(VcsAdapterSchema, adapter);

        if (!parsed.success) throw new Error(`Invalid VCS adapter contract: ${adapter.id}`);
        if (
          record.vcsAdapters.has(adapter.id) ||
          this.extensions.some((extension) => extension.vcsAdapters.has(adapter.id))
        )
          throw new Error(`Invalid or duplicate VCS adapter ID: ${adapter.id}`);
        record.vcsAdapters.set(adapter.id, adapter);
      },
    };

    try {
      await factory(api);
    } catch (err) {
      record.exporters.clear();
      record.vcsAdapters.clear();
      record.errors.push(err instanceof Error ? err.message : String(err));
    }
    this.extensions.push(record);

    return record;
  }
}
