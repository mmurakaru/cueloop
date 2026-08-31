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
import * as v from "valibot";
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
export const DEFAULT_KEYS: CueloopConfig["keys"] = {
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

const ConfigDocumentSchema = v.object({
  actions: v.optional(v.array(v.unknown())),
  authors: v.optional(v.unknown()),
  integrations: v.optional(v.unknown()),
  keys: v.optional(v.unknown()),
  theme: v.optional(v.unknown()),
  ui: v.optional(v.unknown()),
});

const QuickActionSchema = v.object({
  prompt: v.pipe(
    v.string(),
    v.check((prompt) => Boolean(prompt.trim())),
  ),
  metadata: v.optional(v.string()),
});

const AuthorsSchema = v.record(v.string(), v.string());
const KeysSchema = v.record(v.string(), v.union([v.string(), v.array(v.string())]));
const UiSchema = v.object({
  auto_close: v.optional(v.union([v.literal("off"), v.pipe(v.number(), v.minValue(0))])),
  editor: v.optional(v.string()),
  review_width: v.optional(v.pipe(v.number(), v.finite())),
  review_state: v.optional(v.picklist(["expanded", "compact", "hidden"])),
  theme: v.optional(v.string()),
});
const ObsidianSchema = v.object({
  vault: v.optional(v.string()),
  folder: v.optional(v.string()),
  filenameFormat: v.optional(v.string()),
  separator: v.optional(v.picklist(["space", "dash", "underscore"])),
  exportOn: v.optional(v.picklist(["approve", "resolve", "manual"])),
});
const IntegrationsSchema = v.object({ obsidian: v.optional(ObsidianSchema) });
const ThemeOverridesSchema = v.partial(
  v.object({
    background: v.string(),
    panel: v.string(),
    elevated: v.string(),
    border: v.string(),
    text: v.string(),
    textMuted: v.string(),
    textDim: v.string(),
    accent: v.string(),
    accentInk: v.string(),
    green: v.string(),
    red: v.string(),
    blue: v.string(),
    cursorBackground: v.string(),
    markCommentBackground: v.string(),
    insertedForeground: v.string(),
    deletedForeground: v.string(),
    backdrop: v.string(),
  }),
);

function parseToml(text: string) {
  return v.parse(ConfigDocumentSchema, Bun.TOML.parse(text));
}

function parseActions(entries: readonly unknown[] | undefined): QuickAction[] | undefined {
  if (!entries) return undefined;
  const actions: QuickAction[] = [];

  for (const entry of entries) {
    const result = v.safeParse(QuickActionSchema, entry);

    if (!result.success) continue;
    const { prompt, metadata } = result.output;

    actions.push(metadata?.trim() ? { prompt, metadata } : { prompt });
  }

  return actions.length ? actions : undefined;
}

function layer(base: CueloopConfig, raw: v.InferOutput<typeof ConfigDocumentSchema>): CueloopConfig {
  const out: CueloopConfig = {
    keys: { ...base.keys },
    theme: { ...base.theme },
    themeOverrides: { ...base.themeOverrides },
    ui: { ...base.ui },
    authors: { ...base.authors },
    actions: [...base.actions],
    integrations: { obsidian: { ...base.integrations.obsidian } },
  };
  const actions = parseActions(raw.actions);
  const authors = v.safeParse(AuthorsSchema, raw.authors);
  const keys = v.safeParse(KeysSchema, raw.keys);
  const ui = v.safeParse(UiSchema, raw.ui);
  const integrations = v.safeParse(IntegrationsSchema, raw.integrations);

  if (actions) out.actions = actions;
  if (authors.success) Object.assign(out.authors, authors.output);
  if (keys.success) {
    for (const [action, combo] of Object.entries(keys.output)) {
      out.keys[action] = Array.isArray(combo) ? combo : [combo];
    }
  }
  if (ui.success) {
    if (ui.output.auto_close !== undefined) out.ui.autoClose = ui.output.auto_close;
    if (ui.output.editor?.trim()) out.ui.editor = ui.output.editor.trim();
    if (ui.output.review_width !== undefined) out.ui.reviewWidth = clampWidth(ui.output.review_width);
    if (ui.output.review_state !== undefined) out.ui.reviewState = ui.output.review_state;
  }
  if (integrations.success && integrations.output.obsidian) {
    Object.assign(out.integrations.obsidian, integrations.output.obsidian);
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
      const ui = v.safeParse(UiSchema, raw.ui);
      const rawTheme = ui.success ? ui.output.theme : undefined;
      const parsedThemeOverrides = v.safeParse(ThemeOverridesSchema, raw.theme);

      if (rawTheme && isThemeName(rawTheme)) themeName = rawTheme;
      if (parsedThemeOverrides.success) Object.assign(themeOverrides, parsedThemeOverrides.output);
    } catch {
      // a broken config never blocks a review; defaults win
    }
  }
  config.ui.theme = themeName;
  config.themeOverrides = themeOverrides;
  config.theme = { ...themeForName(themeName), ...themeOverrides };

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
