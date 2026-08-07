/**
 * Extension discovery and loading (#10): zero-build TypeScript executed
 * directly. Global user extensions always load; repo-local `.cueloop/
 * extensions/` loads only when the repo is trusted (persisted decisions
 * under the cueloop home).
 */

import { existsSync, readdirSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { Registry } from "./registry";
import type { ExtensionFactory } from "./types";

export function userExtensionsDir(): string {
  return join(process.env.XDG_CONFIG_HOME ?? join(homedir(), ".config"), "cueloop", "extensions");
}

export interface LoadOptions {
  registry: Registry;
  userDir?: string;
  repoRoot?: string;
  /** Persisted trust decisions live under the cueloop home. */
  home?: string;
  /** Trust resolver for untrusted repos; default denies (never prompt-free). */
  confirmTrust?: (repoRoot: string) => Promise<boolean>;
}

interface TrustStore {
  trusted: string[];
}

function trustPath(home: string): string {
  return join(home, "trusted-repos.json");
}

export function readTrust(home: string): TrustStore {
  try {
    return JSON.parse(readFileSync(trustPath(home), "utf8")) as TrustStore;
  } catch {
    return { trusted: [] };
  }
}

export function grantTrust(home: string, repoRoot: string): void {
  const store = readTrust(home);
  if (!store.trusted.includes(repoRoot)) store.trusted.push(repoRoot);
  mkdirSync(home, { recursive: true });
  writeFileSync(trustPath(home), JSON.stringify(store, null, 2));
}

function extensionFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith(".ts") || f.endsWith(".js"))
    .map((f) => join(dir, f))
    .sort();
}

export async function loadExtensions(opts: LoadOptions): Promise<{ loaded: string[]; skipped: string[] }> {
  const loaded: string[] = [];
  const skipped: string[] = [];
  const files: { path: string; source: string }[] = [];

  for (const path of extensionFiles(opts.userDir ?? userExtensionsDir())) {
    files.push({ path, source: "user" });
  }
  if (opts.repoRoot) {
    const repoDir = join(opts.repoRoot, ".cueloop", "extensions");
    const repoFiles = extensionFiles(repoDir);
    if (repoFiles.length) {
      const home = opts.home ?? join(homedir(), ".cueloop");
      const trusted =
        readTrust(home).trusted.includes(opts.repoRoot) ||
        (opts.confirmTrust ? await opts.confirmTrust(opts.repoRoot) : false);
      if (trusted) {
        grantTrust(home, opts.repoRoot);
        for (const path of repoFiles) files.push({ path, source: "repo" });
      } else {
        skipped.push(...repoFiles);
      }
    }
  }

  for (const file of files) {
    try {
      const mod = (await import(file.path)) as { default?: ExtensionFactory };
      if (typeof mod.default !== "function") {
        skipped.push(file.path);
        continue;
      }
      await opts.registry.load(file.path, mod.default);
      loaded.push(file.path);
    } catch {
      skipped.push(file.path);
    }
  }
  return { loaded, skipped };
}
