/**
 * Layered TOML config: built-in defaults → user config → trusted repo
 * config → env. Sections: [keys] action = "combo" (every action rebindable),
 * [theme] per-token overrides, [ui] auto_close + editor + theme (a named
 * preset) + the review-panel layout (review_width + review_state),
 * [integrations.obsidian] notes-vault export.
 */

import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { OBSIDIAN_DEFAULTS, type ObsidianConfig } from "@cueloop/integration-obsidian";
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DARK, type Theme } from "./theme";
import { DEFAULT_THEME_NAME, isThemeName, themeForName, type ThemeName } from "./theme-presets";
import { REVIEW_DEFAULT_WIDTH, clampWidth, type ReviewPanelMode } from "./review-panel";

export interface KeymapConfig {
  [action: string]: string | string[];
}

export interface IntegrationsConfig {
  obsidian: ObsidianConfig;
}

/** Post-submit behavior: "off" prompts, 0 closes instantly, N counts down. */
export type AutoClose = "off" | number;

/** One marker-popover quick action: a preset comment body, plus optional extra lines. */
export interface QuickAction {
  prompt: string;
  metadata?: string;
}

/** The built-in quick-actions for the marker popover when no `[[actions]]` are configured. */
export const DEFAULT_QUICK_ACTIONS: QuickAction[] = [
  {
    prompt: "Zoom out, research in depth",
    metadata: "Research the broader problem, prior art, and alternatives before changing anything.",
  },
  {
    prompt: "Restate simplified",
    metadata: "Restate this as the simplest thing that works and cut the incidental complexity.",
  },
  {
    prompt: "Out of scope",
    metadata:
      "This is out of scope for the task, so capture it as a follow-up instead of doing it now.",
  },
  {
    prompt: "Let's chat about this",
    metadata:
      "Do not implement yet, and surface the open questions and trade-offs so we decide together.",
  },
  {
    prompt: "Prototype this",
    metadata: "Build a throwaway prototype to answer the question, skipping tests and polish.",
  },
  {
    prompt: "Ensure 0 regressions",
    metadata:
      "Characterize the current behavior with tests first, then keep them green through the change.",
  },
  {
    prompt: "Consider existing repo patterns",
    metadata:
      "Follow the nearest existing pattern in this codebase rather than introducing a new one.",
  },
];

/** The comment body a quick action expands to: the prompt, then its system prompt when set. */
export function quickActionBody(action: QuickAction): string {
  return action.metadata ? `${action.prompt}\n\n${action.metadata}` : action.prompt;
}

/** Resolve a quick action by 1-based index or case-insensitive prompt; undefined when no match. */
export function resolveQuickAction(
  actions: QuickAction[],
  actionRef: string,
): QuickAction | undefined {
  const index = Number(actionRef);
  if (Number.isInteger(index) && index >= 1 && index <= actions.length) return actions[index - 1];
  const wanted = actionRef.trim().toLowerCase();
  return actions.find((action) => action.prompt.toLowerCase() === wanted);
}

export interface CueloopConfig {
  keys: Record<string, string[]>;
  theme: Theme;
  /** The `[theme]` per-token overrides alone, so a live theme switch can re-compose them onto a new preset. */
  themeOverrides: Partial<Theme>;
  /**
   * ui.reviewState / ui.reviewWidth are CLIENT VIEW STATE: the review panel's
   * collapse mode and expanded-rail width, persisted so they survive restarts.
   */
  ui: {
    autoClose: AutoClose;
    editor?: string;
    reviewState: ReviewPanelMode;
    reviewWidth: number;
    /** The selected theme preset name; its tokens are the base for `theme`, before any `[theme]` overrides. */
    theme: ThemeName;
  };
  /** Planner-local author renames: identity id → display name ([authors] table). */
  authors: Record<string, string>;
  /** Marker-popover quick actions ([[actions]] tables); the 5 defaults when unset. */
  actions: QuickAction[];
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
  cut: ["x"],
  reject_hunk: ["X"],
  restore_curation: ["u"],
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

/**
 * Parse a `[[actions]]` array-of-tables. A table without a non-empty `prompt`
 * is skipped; any valid table REPLACES the defaults (the whole set is the
 * user's, not merged). Returns undefined when nothing usable is present.
 */
function parseActions(raw: unknown): QuickAction[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const actions: QuickAction[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") continue;
    const table = entry as Record<string, unknown>;
    const prompt = table["prompt"];
    if (typeof prompt !== "string" || !prompt.trim()) continue;
    const metadata = table["metadata"];
    actions.push(
      typeof metadata === "string" && metadata.trim() ? { prompt, metadata } : { prompt },
    );
  }
  return actions.length ? actions : undefined;
}

function layer(base: CueloopConfig, raw: Record<string, unknown>): CueloopConfig {
  const out: CueloopConfig = {
    keys: { ...base.keys },
    theme: { ...base.theme },
    themeOverrides: { ...base.themeOverrides },
    ui: { ...base.ui },
    authors: { ...base.authors },
    actions: [...base.actions],
    integrations: { obsidian: { ...base.integrations.obsidian } },
  };
  const actions = parseActions(raw["actions"]);
  if (actions) out.actions = actions;
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
    themeOverrides: {},
    ui: {
      autoClose: "off",
      reviewState: "expanded",
      reviewWidth: REVIEW_DEFAULT_WIDTH,
      theme: DEFAULT_THEME_NAME,
    },
    authors: {},
    actions: [...DEFAULT_QUICK_ACTIONS],
    integrations: { obsidian: { ...OBSIDIAN_DEFAULTS } },
  };
  // Theme name and per-token overrides are separate concerns, composed once
  // after all layers: the last file to set [ui] theme wins, and every [theme]
  // override from every file lands on top - so a later preset never discards an
  // earlier file's token overrides.
  let themeName = DEFAULT_THEME_NAME;
  const themeOverrides: Partial<Record<keyof Theme, string>> = {};
  const userPath = userConfigPathFrom(options.userConfigPath);
  for (const path of [
    userPath,
    options.repoRoot ? join(options.repoRoot, ".cueloop", "config.toml") : undefined,
  ]) {
    if (!path || !existsSync(path)) continue;
    try {
      const raw = parseToml(readFileSync(path, "utf8"));
      config = layer(config, raw);
      const rawTheme = (raw["ui"] as { theme?: unknown } | undefined)?.theme;
      if (typeof rawTheme === "string" && isThemeName(rawTheme)) themeName = rawTheme;
      collectThemeOverrides(raw["theme"], themeOverrides);
    } catch {
      // a broken config never blocks a review; defaults win
    }
  }
  config.ui.theme = themeName;
  config.themeOverrides = themeOverrides;
  config.theme = { ...themeForName(themeName), ...themeOverrides };
  return config;
}

/** Merge a raw `[theme]` table's known string tokens into the accumulated overrides. */
function collectThemeOverrides(raw: unknown, into: Partial<Record<keyof Theme, string>>): void {
  if (!raw || typeof raw !== "object") return;
  for (const [token, value] of Object.entries(raw)) {
    if (token in DARK && typeof value === "string") into[token as keyof Theme] = value;
  }
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

/** A double-quoted TOML basic string with the quote-breaking characters escaped. */
function tomlString(value: string): string {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n")}"`;
}

/**
 * Persist the whole quick-action set as `[[actions]]` tables, replacing any
 * existing ones. The set is the user's entire vocabulary (not merged), so the
 * old blocks are stripped and the new ones appended. An empty set clears them.
 */
export function persistActions(actions: QuickAction[], userConfigPath?: string): void {
  const path = userConfigPathFrom(userConfigPath);
  let text = existsSync(path) ? readFileSync(path, "utf8") : "";
  // strip every existing [[actions]] block (header through its key lines)
  text = text.replace(/^\[\[actions\]\][^[]*/gm, "").trimEnd();
  const blocks = actions
    .map((action) => {
      const lines = [`[[actions]]`, `prompt = ${tomlString(action.prompt)}`];
      if (action.metadata) lines.push(`metadata = ${tomlString(action.metadata)}`);
      return lines.join("\n");
    })
    .join("\n\n");
  text = blocks ? `${text ? `${text}\n\n` : ""}${blocks}\n` : `${text}\n`;
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

/** Persist the selected theme preset (`[ui] theme`) into the user config. */
export function persistTheme(name: ThemeName, userConfigPath?: string): void {
  persistUiSetting("theme", `"${name}"`, userConfigPath);
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
