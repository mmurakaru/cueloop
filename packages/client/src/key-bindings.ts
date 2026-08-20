/**
 * Binding resolution over @opentui/keymap: the loaded config keymap
 * registers as layers (grammar, span, compose, submit, completion) on one
 * Keymap instance, key events resolve to action names through its dispatch,
 * and the status-line hints generate from getActiveKeys() - a rebound key
 * shows its real binding in the hints. The pure intent reducer (keymap.ts)
 * stays the dispatch layer beneath: this module answers "which action", the
 * reducer answers "which intents".
 */

import { Keymap, type KeymapEvent, type KeymapHost } from "@opentui/keymap";
import { registerDefaultKeys } from "@opentui/keymap/addons";
import type { KeyState } from "./keymap";

export interface ResolvableKey {
  name: string;
  shift: boolean;
}

/** The layer-activation slice of the view state. */
export interface KeyLayerContext {
  overlay: KeyState["overlay"];
  spanMode: boolean;
}

/** Hint templates keyed by the same view states the status line shows. */
export type HintMode =
  | "normal"
  | "collaborator"
  | "card"
  | "span"
  | "compose"
  | "submit"
  | "walk"
  | "read-only";

export interface CheatsheetEntry {
  keys: string;
  label: string;
}
export interface CheatsheetSection {
  title: string;
  entries: CheatsheetEntry[];
}

type HintEntry = { text: string } | { commands: string[]; label: string; labelFirst?: boolean };

const HINT_TEMPLATES: Record<HintMode, HintEntry[]> = {
  normal: [
    { commands: ["down", "up"], label: "move" },
    { commands: ["span"], label: "span" },
    { text: "drag selects" },
    { commands: ["comment"], label: "comment" },
    { commands: ["cut"], label: "cut" },
    { commands: ["edit"], label: "edit" },
    { commands: ["next_annotation", "prev_annotation"], label: "annotations" },
    { commands: ["submit"], label: "submit" },
    { commands: ["quit"], label: "quit" },
  ],
  // A share viewer: annotate and navigate, no plan edit / verdict submit.
  collaborator: [
    { commands: ["down", "up"], label: "move" },
    { commands: ["span"], label: "span" },
    { text: "drag selects" },
    { commands: ["comment"], label: "comment" },
    { commands: ["next_annotation", "prev_annotation"], label: "annotations" },
    { commands: ["quit"], label: "quit" },
  ],
  card: [
    { text: "card" },
    { commands: ["edit"], label: "edit" },
    { commands: ["cut"], label: "Cut" },
    { commands: ["next_annotation", "prev_annotation"], label: "cards" },
    { commands: ["deselect"], label: "deselect" },
    { commands: ["submit"], label: "submit" },
  ],
  span: [
    { text: "span" },
    { commands: ["span_grow", "span_shrink"], label: "grow/shrink" },
    { commands: ["span_slide_forward", "span_slide_back"], label: "slide" },
    { commands: ["span_to_end"], label: "end" },
    { commands: ["span_comment"], label: "comment" },
    { commands: ["span_cancel"], label: "" },
  ],
  compose: [
    { text: "typing" },
    { commands: ["save_compose"], label: "save" },
    { commands: ["cancel_overlay"], label: "cancel" },
  ],
  submit: [
    { commands: ["cycle_verdict_left", "cycle_verdict_right"], label: "verdict", labelFirst: true },
    { commands: ["submit_verdict"], label: "submit" },
    { commands: ["cancel_submit"], label: "cancel" },
  ],
  walk: [
    { text: "walk" },
    { commands: ["walk_next"], label: "next (marks viewed)" },
    { commands: ["walk_prev"], label: "back" },
    { commands: ["walk_leave"], label: "leave walk" },
    { commands: ["quit"], label: "quit" },
  ],
  "read-only": [
    { text: "observer - read-only" },
    { commands: ["down", "up"], label: "move" },
    { commands: ["next_annotation", "prev_annotation"], label: "annotations" },
    { commands: ["quit"], label: "quit" },
  ],
};

/** Status-line glyphs for named keys. */
const KEY_GLYPHS: Record<string, string> = {
  return: "enter",
  enter: "enter",
  escape: "esc",
  left: "←",
  right: "→",
  backspace: "⌫",
  down: "↓",
  up: "↑",
};

function makeKeymapEvent(name: string, shift = false): KeymapEvent {
  return {
    name,
    ctrl: false,
    shift,
    meta: false,
    preventDefault: () => {},
    stopPropagation: () => {},
    propagationStopped: false,
  };
}

class HeadlessKeymapHost implements KeymapHost<object, KeymapEvent> {
  readonly metadata = {
    platform: "unknown" as const,
    primaryModifier: "unknown" as const,
    modifiers: {
      ctrl: "supported" as const,
      shift: "supported" as const,
      meta: "supported" as const,
      super: "unknown" as const,
      hyper: "unknown" as const,
    },
  };
  readonly rootTarget = {};
  readonly isDestroyed = false;
  private readonly pressListeners = new Set<(event: KeymapEvent) => void>();

  getFocusedTarget(): object | null {
    return null;
  }
  getParentTarget(): object | null {
    return null;
  }
  isTargetDestroyed(): boolean {
    return false;
  }
  onKeyPress(listener: (event: KeymapEvent) => void): () => void {
    this.pressListeners.add(listener);
    return () => this.pressListeners.delete(listener);
  }
  onKeyRelease(): () => void {
    return () => {};
  }
  onFocusChange(): () => void {
    return () => {};
  }
  onTargetDestroy(): () => void {
    return () => {};
  }
  createCommandEvent(): KeymapEvent {
    return makeKeymapEvent("");
  }
  emitKeyPress(event: KeymapEvent): void {
    for (const listener of this.pressListeners) listener(event);
  }
}

/**
 * Terminal key events name shifted letters either "g"+shift or "G"; the
 * keymap's canonical form is lowercase + the shift modifier. Non-letter
 * single characters ("$", "0") already encode their shift in the character.
 */
function normalizedEvent(key: ResolvableKey): { name: string; shift: boolean } {
  if (key.name.length === 1) {
    if (/[a-zA-Z]/.test(key.name)) {
      return {
        name: key.name.toLowerCase(),
        shift: key.shift || key.name !== key.name.toLowerCase(),
      };
    }
    return { name: key.name, shift: false };
  }
  return { name: key.name, shift: key.shift };
}

/** Config combos write shifted letters as uppercase; the parser wants shift+. */
function bindingKeyFor(combo: string): string {
  if (combo.length === 1 && /[A-Z]/.test(combo)) return `shift+${combo.toLowerCase()}`;
  return combo;
}

/** The grammar actions live in the base layer; these live in mode layers. */
const SPAN_COMMANDS: [key: string, command: string][] = [
  ["l", "span_grow"],
  ["h", "span_shrink"],
  ["w", "span_slide_forward"],
  ["b", "span_slide_back"],
  ["$", "span_to_end"],
  ["0", "span_to_start"],
  ["c", "span_comment"],
  ["escape", "span_cancel"],
];

export class KeyBindings {
  private readonly host = new HeadlessKeymapHost();
  private readonly keymap = new Keymap<object, KeymapEvent>(this.host);
  private context: KeyLayerContext = { overlay: "none", spanMode: false };
  private resolvedCommand: string | undefined;
  private unregisterGrammarLayer: (() => void) | null = null;

  constructor(keys: Record<string, string[]>) {
    // the standard binding-string parser and event matcher
    registerDefaultKeys(this.keymap);
    // binding/layer `when` fields register runtime matchers, so getActiveKeys
    // and dispatch only see the layer that owns the current mode
    this.keymap.registerLayerFields({
      when: (value, fieldContext) => {
        if (typeof value === "function") fieldContext.activeWhen(value as () => boolean);
      },
    });
    this.registerModeLayers();
    this.setKeys(keys);
  }

  /** Rebuild the grammar layer from a (re)loaded config keymap. */
  setKeys(keys: Record<string, string[]>): void {
    this.unregisterGrammarLayer?.();
    const bindings: { key: string; cmd: string }[] = [];
    const commandNames = new Set<string>();
    for (const [action, combos] of Object.entries(keys)) {
      commandNames.add(action);
      for (const combo of combos) bindings.push({ key: bindingKeyFor(combo), cmd: action });
    }
    // deselect is a hardwired escape in the plan grammar; hints show it
    commandNames.add("deselect");
    bindings.push({ key: "escape", cmd: "deselect" });
    this.unregisterGrammarLayer = this.keymap.registerLayer({
      priority: 0,
      when: () => this.context.overlay === "none" && !this.context.spanMode,
      bindings,
      commands: [...commandNames].map((name) => ({
        name,
        run: () => {
          this.resolvedCommand = name;
          return true;
        },
      })),
    });
  }

  private registerModeLayers(): void {
    const record = (name: string) => ({
      name,
      run: () => {
        this.resolvedCommand = name;
        return true;
      },
    });
    this.keymap.registerLayer({
      priority: 10,
      when: () => this.context.overlay === "none" && this.context.spanMode,
      bindings: SPAN_COMMANDS.map(([key, command]) => ({ key, cmd: command })),
      commands: SPAN_COMMANDS.map(([, command]) => record(command)),
    });
    // the walk wizard: prev/next stepping, leave, and submit from the end card
    this.keymap.registerLayer({
      priority: 20,
      when: () => this.context.overlay === "walk",
      bindings: [
        { key: "]", cmd: "walk_next" },
        { key: "[", cmd: "walk_prev" },
        { key: "escape", cmd: "walk_leave" },
        { key: "return", cmd: "walk_submit" },
        { key: "enter", cmd: "walk_submit" },
        { key: "q", cmd: "quit" },
      ],
      commands: [
        record("walk_next"),
        record("walk_prev"),
        record("walk_leave"),
        record("walk_submit"),
        record("quit"),
      ],
    });
    this.keymap.registerLayer({
      priority: 20,
      when: () => this.context.overlay === "compose",
      bindings: [
        { key: "return", cmd: "save_compose" },
        { key: "enter", cmd: "save_compose" },
        { key: "escape", cmd: "cancel_overlay" },
      ],
      commands: [record("save_compose"), record("cancel_overlay")],
    });
    this.keymap.registerLayer({
      priority: 20,
      when: () => this.context.overlay === "submit",
      bindings: [
        { key: "return", cmd: "submit_verdict" },
        { key: "enter", cmd: "submit_verdict" },
        { key: "left", cmd: "cycle_verdict_left" },
        { key: "right", cmd: "cycle_verdict_right" },
        { key: "escape", cmd: "cancel_submit" },
      ],
      commands: [
        record("submit_verdict"),
        record("cycle_verdict_left"),
        record("cycle_verdict_right"),
        record("cancel_submit"),
      ],
    });
    this.keymap.registerLayer({
      priority: 20,
      when: () =>
        this.context.overlay === "completion-prompt" ||
        this.context.overlay === "completion-counting",
      bindings: [
        { key: "return", cmd: "finish_review" },
        { key: "enter", cmd: "finish_review" },
        { key: "q", cmd: "finish_review" },
        { key: "a", cmd: "opt_in_auto_close" },
        { key: "escape", cmd: "dismiss_completion" },
      ],
      commands: [
        record("finish_review"),
        record("opt_in_auto_close"),
        record("dismiss_completion"),
      ],
    });
  }

  setContext(context: KeyLayerContext): void {
    this.context = context;
  }

  /**
   * Resolve a key event to its command name through the keymap's dispatch.
   * In the base grammar layer the command IS the config action name, so the
   * result feeds straight into the intent reducer.
   */
  resolveAction(key: ResolvableKey): string | undefined {
    const normalized = normalizedEvent(key);
    this.resolvedCommand = undefined;
    this.host.emitKeyPress(makeKeymapEvent(normalized.name, normalized.shift));
    return this.resolvedCommand;
  }

  /** First active key display for a command, mapped through the glyph table. */
  private keyDisplayFor(command: string): string | null {
    for (const activeKey of this.keymap.getActiveKeys({ includeBindings: true })) {
      const bindingCommand =
        typeof activeKey.command === "string"
          ? activeKey.command
          : activeKey.bindings?.[0]?.command;
      if (bindingCommand !== command) continue;
      return KEY_GLYPHS[activeKey.stroke.name] ?? activeKey.display;
    }
    return null;
  }

  /** The status-line hint for a view state, generated from the active keys. */
  statusHint(mode: HintMode): string {
    const fragments: string[] = [];
    for (const entry of HINT_TEMPLATES[mode]) {
      if ("text" in entry) {
        fragments.push(entry.text);
        continue;
      }
      const displays = entry.commands
        .map((command) => this.keyDisplayFor(command))
        .filter((display): display is string => display !== null);
      if (!displays.length) continue;
      const keyPart = displays.join("/");
      if (!entry.label) fragments.push(keyPart);
      else
        fragments.push(
          entry.labelFirst ? `${entry.label} ${keyPart}` : `${keyPart} ${entry.label}`,
        );
    }
    return fragments.join(" · ");
  }

  /**
   * The full keybinding cheatsheet, grouped by mode. Each section sets the
   * layer context so getActiveKeys resolves that mode's real bindings, then
   * restores it - a rebound key shows its live binding here too.
   */
  cheatsheet(): CheatsheetSection[] {
    const saved = this.context;
    const build = (context: KeyLayerContext, mode: HintMode, title: string): CheatsheetSection => {
      this.context = context;
      const entries: CheatsheetEntry[] = [];
      for (const entry of HINT_TEMPLATES[mode]) {
        if ("text" in entry || !entry.label) continue;
        const keys = entry.commands
          .map((command) => this.keyDisplayFor(command))
          .filter((display): display is string => display !== null)
          .join(" / ");
        if (keys) entries.push({ keys, label: entry.label });
      }
      return { title, entries };
    };
    const sections = [
      build({ overlay: "none", spanMode: false }, "normal", "Review"),
      build({ overlay: "none", spanMode: true }, "span", "Selection"),
      build({ overlay: "submit", spanMode: false }, "submit", "Submit"),
      build({ overlay: "walk", spanMode: false }, "walk", "Walk"),
    ];
    this.context = saved;
    return sections.filter((section) => section.entries.length > 0);
  }
}
