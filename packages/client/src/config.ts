/**
 * Layered TOML config (#20): built-in defaults → user config → trusted repo
 * config → env. Sections: [keys] action = "combo" (every action rebindable),
 * [theme] per-token overrides, [integrations.obsidian] notes-vault export.
 */

import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { OBSIDIAN_DEFAULTS, type ObsidianConfig } from "@cueloop/integration-obsidian";
import { DARK, type Theme } from "./theme";

export interface KeymapConfig {
  [action: string]: string | string[];
}

export interface IntegrationsConfig {
  obsidian: ObsidianConfig;
}

export interface CueloopConfig {
  keys: Record<string, string[]>;
  theme: Theme;
  integrations: IntegrationsConfig;
}

/** Every action in the grammar, with its default binding(s). */
export const DEFAULT_KEYS: Record<string, string[]> = {
  down: ["j", "down"],
  up: ["k", "up"],
  top: ["g"],
  bottom: ["G"],
  span: ["v"],
  comment: ["c"],
  suggest: ["s"],
  cut: ["x"],
  edit: ["e"],
  next_annotation: ["n"],
  prev_annotation: ["p"],
  delete_annotation: ["backspace"],
  submit: ["return", "enter"],
  quit: ["q"],
};

function parseToml(text: string): Record<string, unknown> {
  // Bun ships a native TOML parser
  return Bun.TOML.parse(text) as Record<string, unknown>;
}

function layer(base: CueloopConfig, raw: Record<string, unknown>): CueloopConfig {
  const out: CueloopConfig = {
    keys: { ...base.keys },
    theme: { ...base.theme },
    integrations: { obsidian: { ...base.integrations.obsidian } },
  };
  const keys = raw["keys"] as KeymapConfig | undefined;
  if (keys) {
    for (const [action, combo] of Object.entries(keys)) {
      out.keys[action] = Array.isArray(combo) ? combo : [combo];
    }
  }
  const theme = raw["theme"] as Partial<Record<keyof Theme, string>> | undefined;
  if (theme) {
    for (const [token, value] of Object.entries(theme)) {
      if (token in out.theme && typeof value === "string") {
        (out.theme as unknown as Record<string, string>)[token] = value;
      }
    }
  }
  const integrations = raw["integrations"] as Record<string, unknown> | undefined;
  const obsidian = integrations?.["obsidian"] as Record<string, unknown> | undefined;
  if (obsidian) {
    const o = out.integrations.obsidian;
    if (typeof obsidian["vault"] === "string") o.vault = obsidian["vault"];
    if (typeof obsidian["folder"] === "string") o.folder = obsidian["folder"];
    if (typeof obsidian["filenameFormat"] === "string") o.filenameFormat = obsidian["filenameFormat"];
    const sep = obsidian["separator"];
    if (sep === "space" || sep === "dash" || sep === "underscore") o.separator = sep;
    const on = obsidian["exportOn"];
    if (on === "approve" || on === "resolve" || on === "manual") o.exportOn = on;
  }
  return out;
}

export function loadConfig(opts: { repoRoot?: string; userConfigPath?: string } = {}): CueloopConfig {
  let config: CueloopConfig = {
    keys: { ...DEFAULT_KEYS },
    theme: { ...DARK },
    integrations: { obsidian: { ...OBSIDIAN_DEFAULTS } },
  };
  const userPath =
    opts.userConfigPath ??
    process.env.CUELOOP_CONFIG ??
    join(process.env.XDG_CONFIG_HOME ?? join(homedir(), ".config"), "cueloop", "config.toml");
  for (const path of [userPath, opts.repoRoot ? join(opts.repoRoot, ".cueloop", "config.toml") : undefined]) {
    if (!path || !existsSync(path)) continue;
    try {
      config = layer(config, parseToml(readFileSync(path, "utf8")));
    } catch {
      // a broken config never blocks a review; defaults win
    }
  }
  return config;
}

/** Reverse lookup: key name (+shift) → action, per the loaded keymap. */
export function actionFor(keys: Record<string, string[]>, name: string, shift: boolean): string | undefined {
  const wanted = shift && name.length === 1 ? name.toUpperCase() : name;
  for (const [action, combos] of Object.entries(keys)) {
    if (combos.includes(wanted)) return action;
  }
  return undefined;
}
