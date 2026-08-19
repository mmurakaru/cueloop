/**
 * Layered TOML config: built-in defaults → user config → trusted repo
 * config → env. Sections: [keys] action = "combo" (every action rebindable),
 * [theme] per-token overrides, [ui] auto_close + editor + the review-panel
 * layout (review_width + review_state), [integrations.obsidian] notes-vault
 * export.
 */

import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { OBSIDIAN_DEFAULTS, type ObsidianConfig } from "@cueloop/integration-obsidian";
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DARK, type Theme } from "./theme";
import { REVIEW_DEFAULT_WIDTH, clampWidth, type ReviewPanelMode } from "./review-panel";

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
  /**
   * ui.reviewState / ui.reviewWidth are CLIENT VIEW STATE: the review panel's
   * collapse mode and expanded-rail width, persisted so they survive restarts.
   */
  ui: { autoClose: AutoClose; editor?: string; reviewState: ReviewPanelMode; reviewWidth: number };
  /** Planner-local author renames: identity id → display name ([authors] table). */
  authors: Record<string, string>;
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
  rename: ["r"],
  submit: ["return", "enter"],
  share: ["S"],
  quit: ["q"],
  walk: ["w"],
  review_cycle: ["b"],
  review_wider: ["]"],
  review_narrower: ["["],
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
    authors: { ...base.authors },
    integrations: { obsidian: { ...base.integrations.obsidian } },
  };
  const authors = raw["authors"] as Record<string, unknown> | undefined;
  if (authors) {
    for (const [id, value] of Object.entries(authors)) {
      if (typeof value === "string") out.authors[id] = value;
    }
  }
  const keys = raw["keys"] as KeymapConfig | undefined;
  if (keys) {
    for (const [action, combo] of Object.entries(keys)) {
      out.keys[action] = Array.isArray(combo) ? combo : [combo];
    }
  }
  const ui = raw["ui"] as
    | { auto_close?: unknown; editor?: unknown; review_width?: unknown; review_state?: unknown }
    | undefined;
  if (ui && ui.auto_close !== undefined) {
    if (ui.auto_close === "off") out.ui.autoClose = "off";
    else if (typeof ui.auto_close === "number" && ui.auto_close >= 0)
      out.ui.autoClose = ui.auto_close;
  }
  if (ui && typeof ui.editor === "string" && ui.editor.trim()) out.ui.editor = ui.editor.trim();
  if (ui && typeof ui.review_width === "number" && Number.isFinite(ui.review_width)) {
    out.ui.reviewWidth = clampWidth(ui.review_width);
  }
  if (
    ui &&
    (ui.review_state === "expanded" ||
      ui.review_state === "compact" ||
      ui.review_state === "hidden")
  ) {
    out.ui.reviewState = ui.review_state;
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
    const obsidianConfig = out.integrations.obsidian;
    if (typeof obsidian["vault"] === "string") obsidianConfig.vault = obsidian["vault"];
    if (typeof obsidian["folder"] === "string") obsidianConfig.folder = obsidian["folder"];
    if (typeof obsidian["filenameFormat"] === "string")
      obsidianConfig.filenameFormat = obsidian["filenameFormat"];
    const separator = obsidian["separator"];
    if (separator === "space" || separator === "dash" || separator === "underscore")
      obsidianConfig.separator = separator;
    const exportOn = obsidian["exportOn"];
    if (exportOn === "approve" || exportOn === "resolve" || exportOn === "manual")
      obsidianConfig.exportOn = exportOn;
  }
  return out;
}

export function loadConfig(
  options: { repoRoot?: string; userConfigPath?: string } = {},
): CueloopConfig {
  let config: CueloopConfig = {
    keys: { ...DEFAULT_KEYS },
    theme: { ...DARK },
    ui: { autoClose: "off", reviewState: "expanded", reviewWidth: REVIEW_DEFAULT_WIDTH },
    authors: {},
    integrations: { obsidian: { ...OBSIDIAN_DEFAULTS } },
  };
  const userPath = userConfigPathFrom(options.userConfigPath);
  for (const path of [
    userPath,
    options.repoRoot ? join(options.repoRoot, ".cueloop", "config.toml") : undefined,
  ]) {
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
export function actionFor(
  keys: Record<string, string[]>,
  name: string,
  shift: boolean,
): string | undefined {
  const wanted = shift && name.length === 1 ? name.toUpperCase() : name;
  for (const [action, combos] of Object.entries(keys)) {
    if (combos.includes(wanted)) return action;
  }
  return undefined;
}

function userConfigPathFrom(userConfigPath?: string): string {
  return (
    userConfigPath ??
    process.env.CUELOOP_CONFIG ??
    join(process.env.XDG_CONFIG_HOME ?? join(homedir(), ".config"), "cueloop", "config.toml")
  );
}

/**
 * Persist one `[ui]` key into the user config file. Line-level TOML surgery on
 * the keys we own: replace the existing assignment, or drop it under an `[ui]`
 * section (appending the section when absent) - a full TOML writer is not worth
 * its weight here.
 */
function persistUiSetting(key: string, rendered: string, userConfigPath?: string): void {
  const path = userConfigPathFrom(userConfigPath);
  let text = "";
  if (existsSync(path)) text = readFileSync(path, "utf8");
  const assignment = new RegExp(`^(\\s*)${key}\\s*=.*$`, "m");
  if (assignment.test(text)) {
    text = text.replace(assignment, `$1${key} = ${rendered}`);
  } else if (/^\[ui\]/m.test(text)) {
    text = text.replace(/^\[ui\]\s*$/m, `[ui]\n${key} = ${rendered}`);
  } else {
    text = text.trimEnd() + (text.trim() ? "\n\n" : "") + `[ui]\n${key} = ${rendered}\n`;
  }
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
}

/** Persist the auto-close choice (`[ui] auto_close`) into the user config. */
export function persistAutoClose(value: AutoClose, userConfigPath?: string): void {
  persistUiSetting("auto_close", value === "off" ? '"off"' : String(value), userConfigPath);
}

/** Persist the expanded-rail width (`[ui] review_width`) into the user config. */
export function persistReviewWidth(width: number, userConfigPath?: string): void {
  persistUiSetting("review_width", String(clampWidth(width)), userConfigPath);
}

/** Persist the review-panel collapse mode (`[ui] review_state`) into the config. */
export function persistReviewState(state: ReviewPanelMode, userConfigPath?: string): void {
  persistUiSetting("review_state", `"${state}"`, userConfigPath);
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Persist an author rename into the `[authors]` table. The identity id (an SSH
 * fingerprint) is not a bare TOML key, so it is written quoted.
 */
export function persistAuthorName(id: string, name: string, userConfigPath?: string): void {
  const path = userConfigPathFrom(userConfigPath);
  let text = existsSync(path) ? readFileSync(path, "utf8") : "";
  const key = `"${id.replace(/"/g, '\\"')}"`;
  const value = `"${name.replace(/"/g, '\\"')}"`;
  const assignment = new RegExp(`^(\\s*)${escapeRegExp(key)}\\s*=.*$`, "m");
  if (assignment.test(text)) {
    text = text.replace(assignment, `$1${key} = ${value}`);
  } else if (/^\[authors\]/m.test(text)) {
    text = text.replace(/^\[authors\]\s*$/m, `[authors]\n${key} = ${value}`);
  } else {
    text = text.trimEnd() + (text.trim() ? "\n\n" : "") + `[authors]\n${key} = ${value}\n`;
  }
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
}
