/**
 * Vault auto-detection: Obsidian keeps a registry of known vaults in its own
 * config file. We read it and return the vault paths that still exist on
 * disk. The config path is overridable for tests.
 */

import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/** Platform-specific location of Obsidian's own obsidian.json. */
export function obsidianConfigPath(platform: NodeJS.Platform = process.platform): string {
  if (platform === "darwin") {
    return join(homedir(), "Library", "Application Support", "obsidian", "obsidian.json");
  }
  if (platform === "win32") {
    return join(
      process.env.APPDATA ?? join(homedir(), "AppData", "Roaming"),
      "obsidian",
      "obsidian.json",
    );
  }
  return join(
    process.env.XDG_CONFIG_HOME ?? join(homedir(), ".config"),
    "obsidian",
    "obsidian.json",
  );
}

/** Vault paths registered with Obsidian that exist on disk. */
export function detectVaults(configPath: string = obsidianConfigPath()): string[] {
  try {
    const raw = JSON.parse(readFileSync(configPath, "utf8")) as {
      vaults?: Record<string, { path?: string }>;
    };
    return Object.values(raw.vaults ?? {})
      .map((vault) => vault.path)
      .filter((path): path is string => typeof path === "string" && existsSync(path));
  } catch {
    // no Obsidian install, or an unreadable registry: no vaults
    return [];
  }
}
