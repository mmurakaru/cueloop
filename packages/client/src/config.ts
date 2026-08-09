/**
 * Layered TOML config: built-in defaults → user config → trusted repo
 * config → env. Sections: [keys] action = "combo" (every action rebindable),
 * [theme] per-token overrides, [ui] auto_close + editor, [integrations.obsidian]
 * notes-vault export.
 */

import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { OBSIDIAN_DEFAULTS, type ObsidianConfig } from "@cueloop/integration-obsidian";
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DARK, type Theme } from "./theme";

export interface KeymapConfig {
  [action: string]: string | string[];
}

export interface IntegrationsConfig {
  obsidian: ObsidianConfig;
}

/** Post-submit behavior: "off" prompts, 0 closes instantly, N counts down. */
export type AutoClose = "off" | number;

export interface CueloopConfig {
  keys: Record<string, string[]>;
  theme: Theme;
  ui: { autoClose: AutoClose; editor?: string };
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
  walk: ["w"],
};

function parseToml(text: string): Record<string, unknown> {
  // Bun ships a native TOML parser
  return Bun.TOML.parse(text) as Record<string, unknown>;
}

function layer(base: CueloopConfig, raw: Record<string, unknown>): CueloopConfig {
  const out: CueloopConfig = {
    keys: { ...base.keys },
    theme: { ...base.theme },
    ui: { ...base.ui },
    integrations: { obsidian: { ...base.integrations.obsidian } },
  };
  const keys = raw["keys"] as KeymapConfig | undefined;
  if (keys) {
    for (const [action, combo] of Object.entries(keys)) {
      out.keys[action] = Array.isArray(combo) ? combo : [combo];
    }
  }
  const ui = raw["ui"] as { auto_close?: unknown; editor?: unknown } | undefined;
  if (ui && ui.auto_close !== undefined) {
    if (ui.auto_close === "off") out.ui.autoClose = "off";
    else if (typeof ui.auto_close === "number" && ui.auto_close >= 0) out.ui.autoClose = ui.auto_close;
  }
  if (ui && typeof ui.editor === "string" && ui.editor.trim()) out.ui.editor = ui.editor.trim();
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
    const obsidianConfig = out.integrations.obsidian;
    if (typeof obsidian["vault"] === "string") obsidianConfig.vault = obsidian["vault"];
    if (typeof obsidian["folder"] === "string") obsidianConfig.folder = obsidian["folder"];
    if (typeof obsidian["filenameFormat"] === "string") obsidianConfig.filenameFormat = obsidian["filenameFormat"];
    const separator = obsidian["separator"];
    if (separator === "space" || separator === "dash" || separator === "underscore") obsidianConfig.separator = separator;
    const exportOn = obsidian["exportOn"];
    if (exportOn === "approve" || exportOn === "resolve" || exportOn === "manual") obsidianConfig.exportOn = exportOn;
  }
  return out;
}

export function loadConfig(options: { repoRoot?: string; userConfigPath?: string } = {}): CueloopConfig {
  let config: CueloopConfig = {
    keys: { ...DEFAULT_KEYS },
    theme: { ...DARK },
    ui: { autoClose: "off" },
    integrations: { obsidian: { ...OBSIDIAN_DEFAULTS } },
  };
  const userPath =
    options.userConfigPath ??
    process.env.CUELOOP_CONFIG ??
    join(process.env.XDG_CONFIG_HOME ?? join(homedir(), ".config"), "cueloop", "config.toml");
  for (const path of [userPath, options.repoRoot ? join(options.repoRoot, ".cueloop", "config.toml") : undefined]) {
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

/**
 * Persist the auto-close choice into the user config file. Line-level TOML
 * surgery on the one key we own: replace an existing `auto_close`, or append
 * an `[ui]` section - a full TOML writer is not worth its weight here.
 */
export function persistAutoClose(value: AutoClose, userConfigPath?: string): void {
  const path =
    userConfigPath ??
    process.env.CUELOOP_CONFIG ??
    join(process.env.XDG_CONFIG_HOME ?? join(homedir(), ".config"), "cueloop", "config.toml");
  const rendered = value === "off" ? '"off"' : String(value);
  let text = "";
  if (existsSync(path)) text = readFileSync(path, "utf8");
  if (/^\s*auto_close\s*=/m.test(text)) {
    text = text.replace(/^(\s*)auto_close\s*=.*$/m, `$1auto_close = ${rendered}`);
  } else if (/^\[ui\]/m.test(text)) {
    text = text.replace(/^\[ui\]\s*$/m, `[ui]\nauto_close = ${rendered}`);
  } else {
    text = text.trimEnd() + (text.trim() ? "\n\n" : "") + `[ui]\nauto_close = ${rendered}\n`;
  }
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
}
