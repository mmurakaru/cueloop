/**
 * Layered TOML config: built-in defaults → user config → trusted repo
 * config → env. Sections: [keys] action = "combo" (every action rebindable),
 * [theme] per-token overrides, [ui] auto_close + editor + theme (a named
 * preset) + pins, [integrations.obsidian] notes-vault export.
 */

import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { OBSIDIAN_DEFAULTS, type ObsidianConfig } from "@cueloop/integration-obsidian";
import type { VerdictKind } from "@cueloop/schema";
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import * as v from "valibot";
import { DARK, type Theme } from "./theme";
import { DEFAULT_THEME_NAME, isThemeName, themeForName, type ThemeName } from "./theme-presets";
import type { LaunchLayout } from "./launch-layout";

export interface KeymapConfig {
  [action: string]: string | string[];
}

export interface IntegrationsConfig {
  obsidian: ObsidianConfig;
}

/** Post-submit behavior: "off" prompts, 0 closes instantly, N counts down. */
export type AutoClose = "off" | number;

/** How the Changes diff renders when wide: old|new side by side, or one stacked column. A narrow
 *  (unzoomed) pane has no room for two columns, so it is always stacked regardless of this choice. */
export type DiffViewMode = "split" | "stacked";

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
  {
    prompt: "LGTM",
    metadata: "This looks good to me.",
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
  ui: {
    autoClose: AutoClose;
    editor?: string;
    /** The selected theme preset name; its tokens are the base for `theme`, before any `[theme]` overrides. */
    theme: ThemeName;
    /** How the Changes diff renders when wide: old|new side by side or one stacked column. */
    diffView: DiffViewMode;
    /** The verdict the submit card opens on; approve unless set. */
    defaultVerdict: VerdictKind;
    /** Session ids the user has pinned to the top of the sidebar; client-local view state. */
    pins: string[];
    /** The last pane layout a bare launch restores; unset until the user changes one. */
    layout?: LaunchLayout;
  };
  /** Planner-local author renames: identity id → display name ([authors] table). */
  authors: Record<string, string>;
  /** The local reviewer's own display name, and whether it was typed or synced from GitHub ([identity] table). */
  identity: IdentityConfig;
  /** Marker-popover quick actions ([[actions]] tables); the 5 defaults when unset. */
  actions: QuickAction[];
  /** Directory of user-level skills surfaced in the "/" palette ([skills] path); ~/.agents/skills default. */
  skillsPath: string;
  integrations: IntegrationsConfig;
  /** Opt-in experimental features ([experimental] table); all default off. */
  experimental: ExperimentalConfig;
}

export interface ExperimentalConfig {
  /** Render a prototype as a pixel mockup (kitty graphics) instead of the default markdown design doc. */
  prototypePixels: boolean;
}

/** Where a display name came from: typed by the user, or verified from a GitHub login. */
export type IdentityProvider = "typed" | "github";

export interface IdentityConfig {
  /** The reviewer's own display name; absent until they set or sync one. */
  name?: string;
  provider: IdentityProvider;
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
  collapse_file: ["right"],
  expand_file: ["left"],
  split_diff: ["s"],
  edit: ["e"],
  next_annotation: ["n"],
  prev_annotation: ["p"],
  delete_annotation: ["backspace"],
  rename: ["r"],
  submit: ["return", "enter"],
  share: ["S"],
  quit: ["q"],
  walk: ["w"],
};

const SkillsSectionSchema = v.object({ path: v.optional(v.string()) });

function skillsPathFrom(
  raw: v.InferOutput<typeof SkillsSectionSchema> | undefined,
  fallback: string,
): string {
  return raw?.path?.trim() ? raw.path.trim() : fallback;
}

const ConfigDocumentSchema = v.object({
  actions: v.optional(v.array(v.unknown())),
  authors: v.optional(v.unknown()),
  identity: v.optional(v.unknown()),
  integrations: v.optional(v.unknown()),
  keys: v.optional(v.unknown()),
  theme: v.optional(v.unknown()),
  ui: v.optional(v.unknown()),
  experimental: v.optional(v.unknown()),
  skills: v.fallback(v.optional(SkillsSectionSchema), undefined),
});

const IdentitySchema = v.object({
  name: v.fallback(v.optional(v.string()), undefined),
  provider: v.fallback(v.optional(v.picklist(["typed", "github"])), undefined),
});

const QuickActionSchema = v.object({
  prompt: v.pipe(
    v.string(),
    v.check((prompt) => Boolean(prompt.trim())),
  ),
  metadata: v.optional(v.string()),
});

const AuthorsSchema = v.record(v.string(), v.unknown());
const KeysSchema = v.record(v.string(), v.unknown());
const KeyComboSchema = v.union([v.string(), v.array(v.string())]);
// Every field falls back to undefined on its own, so one bad value in a
// section never discards the section's other settings.
const UiSchema = v.object({
  auto_close: v.fallback(
    v.optional(v.union([v.literal("off"), v.pipe(v.number(), v.minValue(0))])),
    undefined,
  ),
  editor: v.fallback(v.optional(v.string()), undefined),
  theme: v.fallback(v.optional(v.string()), undefined),
  diff_view: v.fallback(v.optional(v.picklist(["split", "stacked", "unified"])), undefined),
  default_verdict: v.fallback(
    v.optional(v.picklist(["comment", "approve", "request_changes"])),
    undefined,
  ),
  pins: v.fallback(v.optional(v.array(v.string())), undefined),
  layout: v.fallback(
    v.optional(
      v.object({
        threads: v.fallback(v.optional(v.boolean()), undefined),
        right_sidebar: v.fallback(v.optional(v.picklist(["changes", "project", "off"])), undefined),
        zoom_changes: v.fallback(v.optional(v.boolean()), undefined),
      }),
    ),
    undefined,
  ),
});
const ObsidianSchema = v.object({
  vault: v.fallback(v.optional(v.string()), undefined),
  folder: v.fallback(v.optional(v.string()), undefined),
  filenameFormat: v.fallback(v.optional(v.string()), undefined),
  separator: v.fallback(v.optional(v.picklist(["space", "dash", "underscore"])), undefined),
  exportOn: v.fallback(v.optional(v.picklist(["approve", "resolve", "manual"])), undefined),
});
const IntegrationsSchema = v.object({ obsidian: v.optional(ObsidianSchema) });
const ExperimentalSchema = v.object({
  prototype_pixels: v.fallback(v.optional(v.boolean()), undefined),
});
const ThemeOverridesSchema = v.record(v.string(), v.unknown());

function isThemeToken(token: string): token is keyof Theme {
  return token in DARK;
}

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

function mergeObsidian(
  target: ObsidianConfig,
  obsidian: v.InferOutput<typeof ObsidianSchema>,
): void {
  if (obsidian.vault !== undefined) target.vault = obsidian.vault;
  if (obsidian.folder !== undefined) target.folder = obsidian.folder;
  if (obsidian.filenameFormat !== undefined) target.filenameFormat = obsidian.filenameFormat;
  if (obsidian.separator !== undefined) target.separator = obsidian.separator;
  if (obsidian.exportOn !== undefined) target.exportOn = obsidian.exportOn;
}

/** Fold a parsed `[ui]` table onto the accumulated ui config, field by present field. */
function applyUi(ui: CueloopConfig["ui"], parsed: v.InferOutput<typeof UiSchema>): void {
  if (parsed.auto_close !== undefined) ui.autoClose = parsed.auto_close;
  if (parsed.editor?.trim()) ui.editor = parsed.editor.trim();
  // "unified" is the pre-rename spelling of "stacked"; keep loading it so an upgrade never flips the layout
  if (parsed.diff_view !== undefined)
    ui.diffView = parsed.diff_view === "unified" ? "stacked" : parsed.diff_view;
  if (parsed.default_verdict !== undefined) ui.defaultVerdict = parsed.default_verdict;
  if (parsed.pins !== undefined) ui.pins = parsed.pins;
  if (parsed.layout !== undefined) {
    ui.layout = {
      threads: parsed.layout.threads ?? true,
      rightSidebar: parsed.layout.right_sidebar ?? "changes",
      zoomChanges: parsed.layout.zoom_changes ?? false,
    };
  }
}

function layer(
  base: CueloopConfig,
  raw: v.InferOutput<typeof ConfigDocumentSchema>,
  allowIdentity: boolean,
): CueloopConfig {
  const out: CueloopConfig = {
    keys: { ...base.keys },
    theme: { ...base.theme },
    themeOverrides: { ...base.themeOverrides },
    ui: { ...base.ui },
    authors: { ...base.authors },
    identity: { ...base.identity },
    actions: [...base.actions],
    skillsPath: base.skillsPath,
    integrations: { obsidian: { ...base.integrations.obsidian } },
    experimental: { ...base.experimental },
  };
  const actions = parseActions(raw.actions);
  const authors = v.safeParse(AuthorsSchema, raw.authors);
  const identity = v.safeParse(IdentitySchema, raw.identity);
  const keys = v.safeParse(KeysSchema, raw.keys);
  const ui = v.safeParse(UiSchema, raw.ui);
  const integrations = v.safeParse(IntegrationsSchema, raw.integrations);
  const experimental = v.safeParse(ExperimentalSchema, raw.experimental);

  if (actions) out.actions = actions;
  out.skillsPath = skillsPathFrom(raw.skills, base.skillsPath);
  if (authors.success) {
    for (const [id, value] of Object.entries(authors.output)) {
      const name = v.safeParse(v.string(), value);

      if (name.success) out.authors[id] = name.output;
    }
  }
  if (keys.success) {
    for (const [action, value] of Object.entries(keys.output)) {
      const combo = v.safeParse(KeyComboSchema, value);

      if (combo.success)
        out.keys[action] = Array.isArray(combo.output) ? combo.output : [combo.output];
    }
  }
  // The reviewer identity is a personal credential; a repo must never forge a verified name.
  if (allowIdentity && identity.success) {
    if (identity.output.name !== undefined) out.identity.name = identity.output.name;
    if (identity.output.provider !== undefined) out.identity.provider = identity.output.provider;
  }
  if (ui.success) applyUi(out.ui, ui.output);
  if (integrations.success && integrations.output.obsidian) {
    mergeObsidian(out.integrations.obsidian, integrations.output.obsidian);
  }
  if (experimental.success && experimental.output.prototype_pixels !== undefined) {
    out.experimental.prototypePixels = experimental.output.prototype_pixels;
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
      theme: DEFAULT_THEME_NAME,
      diffView: "split",
      defaultVerdict: "approve",
      pins: [],
    },
    authors: {},
    identity: { provider: "typed" },
    actions: [...DEFAULT_QUICK_ACTIONS],
    skillsPath: join(homedir(), ".agents", "skills"),
    integrations: { obsidian: { ...OBSIDIAN_DEFAULTS } },
    experimental: { prototypePixels: false },
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

      config = layer(config, raw, path === userPath);
      const ui = v.safeParse(UiSchema, raw.ui);
      const rawTheme = ui.success ? ui.output.theme : undefined;
      const parsedThemeOverrides = v.safeParse(ThemeOverridesSchema, raw.theme);

      if (rawTheme && isThemeName(rawTheme)) themeName = rawTheme;
      if (parsedThemeOverrides.success) {
        for (const [token, value] of Object.entries(parsedThemeOverrides.output)) {
          const override = v.safeParse(v.string(), value);

          if (override.success && isThemeToken(token)) themeOverrides[token] = override.output;
        }
      }
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

/** Persist the reviewer's own display name and its provider (`[identity]`) into the user config. */
export function persistIdentity(identity: IdentityConfig, userConfigPath?: string): void {
  const path = userConfigPathFrom(userConfigPath);
  let text = existsSync(path) ? readFileSync(path, "utf8") : "";
  const nameLine = identity.name === undefined ? "" : `name = ${tomlString(identity.name)}\n`;
  const block = `[identity]\n${nameLine}provider = ${tomlString(identity.provider)}\n`;

  if (/^\[identity\]/m.test(text)) {
    // Consume the header and its assignment lines only, so a bracket in a quoted name cannot truncate the block.
    text = text.replace(/^\[identity\].*(?:\n(?![[\n]).*)*\n?/m, block);
  } else {
    text = text.trimEnd() + (text.trim() ? "\n\n" : "") + block;
  }
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
}

/** Persist the auto-close choice (`[ui] auto_close`) into the user config. */
export function persistAutoClose(value: AutoClose, userConfigPath?: string): void {
  persistUiSetting("auto_close", value === "off" ? '"off"' : String(value), userConfigPath);
}

/** Persist the selected theme preset (`[ui] theme`) into the user config. */
export function persistTheme(name: ThemeName, userConfigPath?: string): void {
  persistUiSetting("theme", `"${name}"`, userConfigPath);
}

/** Persist the diff-view choice (`[ui] diff_view`) into the user config. */
export function persistDiffView(mode: DiffViewMode, userConfigPath?: string): void {
  persistUiSetting("diff_view", `"${mode}"`, userConfigPath);
}

/** Persist the pinned-thread ids (`[ui] pins`) into the user config. */
export function persistPins(ids: readonly string[], userConfigPath?: string): void {
  persistUiSetting("pins", `[${ids.map(tomlString).join(", ")}]`, userConfigPath);
}

/** Persist the last pane layout (`[ui] layout`) so a bare launch restores it. */
export function persistLayout(layout: LaunchLayout, userConfigPath?: string): void {
  const table = `{ threads = ${layout.threads}, right_sidebar = "${layout.rightSidebar}", zoom_changes = ${layout.zoomChanges} }`;

  persistUiSetting("layout", table, userConfigPath);
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
