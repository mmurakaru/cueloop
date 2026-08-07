/**
 * Export a session's final plan (working copy when the reviewer edited,
 * else the submitted content) into an Obsidian vault as a markdown note
 * with provenance frontmatter. Pure filesystem writes; never overwrites.
 */

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { ReviewSession, VerdictKind } from "@cueloop/schema";
import { detectVaults } from "./detect";
import { formatFilename, titleFrom, uniquePath, type Separator } from "./filename";
import { frontmatter } from "./frontmatter";

export type ExportOn = "approve" | "resolve" | "manual";

export interface ObsidianConfig {
  /** Vault path; when unset, the first auto-detected vault is used. */
  vault?: string;
  folder: string;
  filenameFormat: string;
  separator: Separator;
  exportOn: ExportOn;
  /** Override for Obsidian's own config file location (tests). */
  obsidianConfigPath?: string;
}

export const OBSIDIAN_DEFAULTS: ObsidianConfig = {
  folder: "cueloop",
  filenameFormat: "{YYYY}-{MM}-{DD} - {title}",
  separator: "space",
  exportOn: "manual",
};

/** approve exports only approvals; resolve exports any verdict; manual never auto-exports. */
export function shouldExport(exportOn: ExportOn, verdict: VerdictKind): boolean {
  if (exportOn === "approve") return verdict === "approve";
  return exportOn === "resolve";
}

export interface ExportResult {
  success: boolean;
  path?: string;
  error?: string;
}

export function exportSession(session: ReviewSession, config: ObsidianConfig, now: Date = new Date()): ExportResult {
  const vault = config.vault ?? detectVaults(config.obsidianConfigPath)[0];
  if (!vault) return { success: false, error: "no Obsidian vault configured or detected" };
  if (!existsSync(vault)) return { success: false, error: `vault not found: ${vault}` };

  const content = session.workingCopy ?? session.artifact.content;
  const title = titleFrom(content, session.artifact.meta.title);
  const dir = join(vault, config.folder);
  mkdirSync(dir, { recursive: true });
  const base = formatFilename(config.filenameFormat, title, now, config.separator);
  const path = uniquePath(dir, base);
  writeFileSync(path, `${frontmatter(session, now)}\n\n${content}`);
  return { success: true, path };
}
