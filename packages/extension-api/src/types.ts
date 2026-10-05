/**
 * The typed extension contract. Import-free beyond the schema, so the
 * contract stays self-contained.
 *
 * An extension is a factory that registers an exporter:
 *   export default (cueloop: ExtensionAPI) => { cueloop.registerExporter(...) }
 * Registration is data written into a per-extension record; the exporter runs
 * later, host-driven. No import-time side effects.
 */

import type { DiffFileContents, DiffFileStatus, Thread } from "@cueloop/schema";

/** Exporters ship resolved sessions somewhere (notes vaults, forges). */
export type Exporter = (
  session: Thread,
) => Promise<{ success: boolean; path?: string; error?: string }>;

/** A source identity links a live diff to an exact captured revision. */
export interface VcsSourceIdentity {
  changeId?: string;
  revisionId: string;
}

/** One complete working-copy capture; file contents must match the returned patch. */
export interface VcsDiffSnapshot {
  patch: string;
  files: DiffFileContents[];
  source?: VcsSourceIdentity;
}

/** The daemon-owned diff source contract; adapters never mutate Threads. */
export interface VcsAdapter {
  apiVersion: 1;
  id: string;
  detect(cwd: string): Promise<string | null>;
  captureWorkingDiff(repoRoot: string): Promise<VcsDiffSnapshot>;
  captureChange?(repoRoot: string, changeId: string): Promise<VcsDiffSnapshot>;
  listChanges(repoRoot: string): Promise<{ path: string; status: DiffFileStatus }[]>;
  listFiles(repoRoot: string): Promise<string[]>;
}

export interface ExtensionAPI {
  registerExporter(name: string, exporter: Exporter): void;
  registerVcsAdapter(adapter: VcsAdapter): void;
}

export type ExtensionFactory = (cueloop: ExtensionAPI) => void | Promise<void>;
