/**
 * The typed extension contract. Import-free beyond the schema, so the
 * contract stays self-contained.
 *
 * An extension is a factory that registers an exporter:
 *   export default (cueloop: ExtensionAPI) => { cueloop.registerExporter(...) }
 * Registration is data written into a per-extension record; the exporter runs
 * later, host-driven. No import-time side effects.
 */

import type { ReviewSession } from "@cueloop/schema";

/** Exporters ship resolved sessions somewhere (notes vaults, forges). */
export type Exporter = (
  session: ReviewSession,
) => Promise<{ success: boolean; path?: string; error?: string }>;

export interface ExtensionAPI {
  registerExporter(name: string, exporter: Exporter): void;
}

export type ExtensionFactory = (cueloop: ExtensionAPI) => void | Promise<void>;
