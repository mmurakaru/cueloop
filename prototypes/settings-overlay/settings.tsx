/**
 * Prototype: a terminal settings overlay + a richer review rail.
 *
 * Two things to react to:
 * 1. The overlay - a centered modal over a dimmed app: a left category nav and
 *    a right body of typed rows (toggle / cycle / text). Opens on ",".
 *    j/k move a row, h/l or space change its value, tab switches nav<->body,
 *    esc closes. Everything is driven off one settings object, applied live.
 * 2. The rail - a tool row (Select/Comment/Cut) and rail tabs (Feedback/Agent)
 *    with more buttons than today's bottom bar, all keyboard- and mouse-driven.
 *
 * Values here are in-memory only; this is a shape probe, not the real config.
 */

import React, { useMemo, useState } from "react";
import { createCliRenderer } from "@opentui/core";
import { createRoot, useKeyboard } from "@opentui/react";
import { DARK as T } from "../../packages/client/src/theme";

type RowKind = "toggle" | "cycle" | "text";
interface Row {
  key: string;
  label: string;
  kind: RowKind;
  hint?: string;
  options?: string[];
}
interface Category {
  id: string;
  icon: string;
  name: string;
  sub: string;
  rows: Row[];
}

const CATEGORIES: Category[] = [
  {
    id: "general",
    icon: "◉",
    name: "General",
    sub: "identity and submission",
    rows: [
      { key: "displayName", label: "Display name", kind: "text" },
      { key: "autoClose", label: "Auto-close on submit", kind: "cycle", options: ["off", "3s", "on"] },
    ],
  },
  {
    id: "theme",
    icon: "◑",
    name: "Theme",
    sub: "palette",
    rows: [
      { key: "theme", label: "Palette", kind: "cycle", options: ["system", "light", "dark"] },
      { key: "monoFont", label: "Mono font", kind: "cycle", options: ["theme", "terminal"] },
    ],
  },
  {
    id: "display",
    icon: "▤",
    name: "Display",
    sub: "plan width and chrome",
    rows: [
      { key: "planWidth", label: "Plan width", kind: "cycle", options: ["default", "wide", "full"] },
      { key: "showLineNumbers", label: "Line numbers", kind: "toggle" },
      { key: "lineIntensity", label: "Line-number intensity", kind: "cycle", options: ["dim", "normal", "bright"] },
    ],
  },
  {
    id: "diff",
    icon: "⇆",
    name: "Diff",
    sub: "layout and granularity",
    rows: [
      { key: "diffStyle", label: "Layout", kind: "cycle", options: ["unified", "split"] },
      { key: "diffGranularity", label: "Granularity", kind: "cycle", options: ["line", "word"] },
      { key: "expandUnchanged", label: "Expand unchanged", kind: "toggle" },
      { key: "hideWhitespace", label: "Hide whitespace", kind: "toggle" },
    ],
  },
  {
    id: "tools",
    icon: "❝",
    name: "Tools",
    sub: "annotation kinds and their prompts",
    rows: [
      { key: "convEnabled", label: "Convention labels", kind: "toggle" },
      { key: "convDefault", label: "Default kind", kind: "cycle", options: ["comment", "suggestion", "nit", "question", "issue"] },
      { key: "nitPrompt", label: "nit → prompt", kind: "text", hint: "appended to the note for the agent" },
      { key: "issuePrompt", label: "issue → prompt", kind: "text" },
      { key: "questionPrompt", label: "question → prompt", kind: "text" },
      { key: "issueBlocking", label: "issue is blocking", kind: "toggle" },
    ],
  },
  {
    id: "saving",
    icon: "⇩",
    name: "Saving",
    sub: "sessions",
    rows: [
      { key: "saveSessions", label: "Persist sessions", kind: "toggle" },
      { key: "defaultSaveAction", label: "On submit", kind: "cycle", options: ["ask", "vault", "none"] },
    ],
  },
  {
    id: "integrations",
    icon: "⇩",
    name: "Integrations",
    sub: "where plans and notes are stored",
    rows: [
      { key: "obsidianEnabled", label: "Obsidian vault", kind: "toggle" },
      { key: "vaultPath", label: "Vault path", kind: "text", hint: "plans are written here" },
      { key: "vaultFolder", label: "Folder in vault", kind: "text" },
    ],
  },
  {
    id: "keys",
    icon: "⌨",
    name: "Keybindings",
    sub: "reference",
    rows: [],
  },
];

const KEYS: [string, string][] = [
  ["j / k", "move cursor"],
  ["c", "comment on line"],
  ["d", "cut line"],
  ["tab", "focus rail"],
  ["n", "submit review"],
  [",", "settings"],
  ["?", "help"],
  ["q", "quit"],
];

type Settings = Record<string, string | boolean>;
const INITIAL: Settings = {
  displayName: "amber-heron",
  autoClose: "3s",
  theme: "dark",
  monoFont: "theme",
  planWidth: "default",
  showLineNumbers: true,
  lineIntensity: "normal",
  diffStyle: "unified",
  diffGranularity: "word",
  expandUnchanged: false,
  hideWhitespace: true,
  convEnabled: true,
  convDefault: "none",
  saveSessions: true,
  defaultSaveAction: "ask",
  nitPrompt: "style only, non-blocking",
  issuePrompt: "must be resolved before merge",
  questionPrompt: "answer inline before proceeding",
  issueBlocking: true,
  obsidianEnabled: false,
  vaultPath: "~/vaults/notes",
  vaultFolder: "cueloop",
};

const PLAN_LINES = [
  ["h1", "Implementation Plan: Session Persistence"],
  ["p", "Review sessions live only in daemon memory today. This plan persists"],
  ["p", "each session to disk so a restarted daemon recovers in-flight reviews."],
  ["h2", "Phase 1: Storage layer"],
  ["li", "- one JSON document per session under the daemon state directory"],
  ["li", "- every write goes through a temp file and an atomic rename"],
  ["li", "- recovery is a read-only scan; bad records are skipped, not deleted"],
  ["h2", "Phase 2: Recovery"],
  ["p", "On boot the daemon scans the sessions directory and rebuilds its index."],
] as const;

function planFg(kind: string): string {
  if (kind === "h1") return T.accent;
  if (kind === "h2") return T.blue;
  if (kind === "li") return T.text;
  return T.textMuted;
}

const TOOLS = [
  { id: "select", icon: "⌖", label: "Select" },
  { id: "comment", icon: "▤", label: "Comment" },
  { id: "cut", icon: "╌", label: "Cut" },
];
const RAIL_TABS = [
  { id: "feedback", label: "Feedback" },
  { id: "agent", label: "Agent" },
];

export function App({ onExit }: { onExit: () => void }): React.ReactNode {
  const [settings, setSettings] = useState<Settings>(INITIAL);
  const [open, setOpen] = useState(false);
  const [zone, setZone] = useState<"nav" | "body">("nav");
  const [catIdx, setCatIdx] = useState(0);
  const [rowIdx, setRowIdx] = useState(0);
  const [tool, setTool] = useState("select");
  const [railTab, setRailTab] = useState("feedback");
  const [flash, setFlash] = useState("");

  const cat = CATEGORIES[catIdx]!;
  const width = process.stdout.columns ?? 120;
  const height = process.stdout.rows ?? 40;

  const cycle = (row: Row, dir: number) => {
    setSettings((s) => {
      if (row.kind === "toggle") return { ...s, [row.key]: !s[row.key] };
      if (row.kind === "cycle" && row.options) {
        const cur = row.options.indexOf(String(s[row.key]));
        const next = (cur + dir + row.options.length) % row.options.length;
        return { ...s, [row.key]: row.options[next]! };
      }
      return s;
    });
    setFlash(`${row.label} updated`);
  };

  useKeyboard((key) => {
    if (open) {
      if (key.name === "escape" || key.name === ",") {
        setOpen(false);
        return;
      }
      if (key.name === "tab") {
        setZone((z) => (z === "nav" ? "body" : "nav"));
        return;
      }
      if (zone === "nav") {
        if (key.name === "j" || key.name === "down") {
          setCatIdx((i) => Math.min(CATEGORIES.length - 1, i + 1));
          setRowIdx(0);
        } else if (key.name === "k" || key.name === "up") {
          setCatIdx((i) => Math.max(0, i - 1));
          setRowIdx(0);
        } else if (key.name === "l" || key.name === "return") setZone("body");
      } else {
        const rows = cat.rows;
        if (key.name === "j" || key.name === "down") setRowIdx((i) => Math.min(rows.length - 1, i + 1));
        else if (key.name === "k" || key.name === "up") setRowIdx((i) => Math.max(0, i - 1));
        else if (key.name === "h") setZone("nav");
        else if (rows[rowIdx]) {
          if (key.name === "l" || key.name === "space" || key.name === "return") cycle(rows[rowIdx]!, 1);
        }
      }
      return;
    }
    if (key.name === "q") onExit();
    else if (key.name === ",") {
      setOpen(true);
      setZone("nav");
    } else if (key.name === "s") setTool("select");
    else if (key.name === "c") setTool("comment");
    else if (key.name === "d") setTool("cut");
    else if (key.name === "tab") setRailTab((t) => (t === "feedback" ? "agent" : "feedback"));
  });

  const body = useMemo(() => {
    if (cat.id === "keys") {
      return KEYS.map(([k, v]) => (
        <box key={k} style={{ flexDirection: "row", height: 1 }}>
          <box style={{ width: 12 }}>
            <text fg={T.accent}>{k}</text>
          </box>
          <text fg={T.textMuted}>{v}</text>
        </box>
      ));
    }
    return cat.rows.map((row, i) => {
      const on = zone === "body" && i === rowIdx;
      const val = settings[row.key];
      const shown = row.kind === "toggle" ? (val ? "on" : "off") : String(val);
      return (
        <box key={row.key} style={{ flexDirection: "row", height: 1, backgroundColor: on ? T.elevated : undefined }} onMouseUp={() => cycle(row, 1)}>
          <box style={{ width: 26, paddingLeft: 1 }}>
            <text fg={on ? T.text : T.textMuted}>{row.label}</text>
          </box>
          <text fg={row.kind === "toggle" && val ? T.green : T.accent}>{shown}</text>
        </box>
      );
    });
  }, [cat, zone, rowIdx, settings]);

  const modalW = Math.min(76, width - 6);
  const modalH = Math.min(22, height - 4);

  return (
    <box style={{ flexDirection: "column", height: "100%", backgroundColor: T.bg }}>
      {/* header with settings button */}
      <box style={{ flexDirection: "row", height: 1, backgroundColor: T.panel }}>
        <text fg={T.accent}> cueloop </text>
        <text fg={T.textDim}>· session persistence · v2</text>
        <box style={{ flexGrow: 1 }} />
        <box onMouseUp={() => setOpen(true)}>
          <text fg={open ? T.accent : T.textDim}>{" settings "}</text>
        </box>
      </box>

      {/* body: plan + rail */}
      <box style={{ flexDirection: "row", flexGrow: 1 }}>
        <box style={{ flexDirection: "column", flexGrow: 1, paddingLeft: 1 }}>
          {PLAN_LINES.map(([kind, text], i) => (
            <text key={i} fg={planFg(kind)}>
              {text}
            </text>
          ))}
        </box>

        {/* rail */}
        <box style={{ flexDirection: "column", width: 30, backgroundColor: T.panel }}>
          <box style={{ flexDirection: "row", height: 1 }}>
            {RAIL_TABS.map((t) => (
              <box key={t.id} style={{ paddingLeft: 1, paddingRight: 1, backgroundColor: railTab === t.id ? T.elevated : undefined }} onMouseUp={() => setRailTab(t.id)}>
                <text fg={railTab === t.id ? T.accent : T.textDim}>{t.label}</text>
              </box>
            ))}
          </box>
          <box style={{ flexGrow: 1, paddingLeft: 1 }}>
            <text fg={T.textDim}>{railTab === "feedback" ? "no annotations yet" : "agent: waiting for verdict"}</text>
          </box>
          {/* tool row */}
          <box style={{ flexDirection: "row", height: 1, backgroundColor: T.elevated }}>
            {TOOLS.map((t) => (
              <box key={t.id} style={{ paddingLeft: 1, paddingRight: 1, backgroundColor: tool === t.id ? T.accent : undefined }} onMouseUp={() => setTool(t.id)}>
                <text fg={tool === t.id ? T.accentInk : T.textMuted}>{t.label}</text>
              </box>
            ))}
          </box>
        </box>
      </box>

      {/* status */}
      <box style={{ flexDirection: "row", height: 1, backgroundColor: T.panel }}>
        <text fg={T.textDim}>{` ${flash || ", settings · c comment · d cut · tab rail · q quit"} `}</text>
      </box>

      {/* settings overlay */}
      {open ? (
        <box style={{ position: "absolute", left: 0, top: 0, width, height, backgroundColor: undefined, alignItems: "center", justifyContent: "center" }}>
          <box
            style={{
              width: modalW,
              height: modalH,
              border: true,
              borderStyle: "rounded",
              borderColor: T.accent,
              backgroundColor: T.panel,
              flexDirection: "column",
            }}
            title=" Settings "
          >
            <box style={{ flexDirection: "row", flexGrow: 1 }}>
              {/* nav */}
              <box style={{ flexDirection: "column", width: 18, paddingLeft: 1, paddingRight: 1 }}>
                <text fg={T.textDim}>SETTINGS</text>
                {CATEGORIES.map((c, i) => {
                  const on = i === catIdx;
                  return (
                    <box key={c.id} style={{ backgroundColor: on && zone === "nav" ? T.elevated : undefined }} onMouseUp={() => { setCatIdx(i); setRowIdx(0); }}>
                      <text fg={on ? T.accent : T.textMuted}>{`${on ? "› " : "  "}${c.name}`}</text>
                    </box>
                  );
                })}
              </box>
              {/* divider */}
              <box style={{ width: 1, backgroundColor: T.border }} />
              {/* body */}
              <box style={{ flexDirection: "column", flexGrow: 1, paddingLeft: 2, paddingRight: 1 }}>
                <text fg={T.text}>{cat.name}</text>
                <text fg={T.textDim}>{cat.sub}</text>
                <box style={{ height: 1 }} />
                {body}
              </box>
            </box>
            <box style={{ flexDirection: "row", height: 1, backgroundColor: T.elevated, paddingLeft: 1 }}>
              <text fg={T.textDim}>{zone === "nav" ? "j/k category · l/⏎ into settings · esc close" : "j/k row · l/space change · h back · esc close"}</text>
            </box>
          </box>
        </box>
      ) : null}
    </box>
  );
}

if (import.meta.main) {
  const renderer = await createCliRenderer();
  createRoot(renderer).render(
    <App
      onExit={() => {
        renderer.destroy();
        process.exit(0);
      }}
    />,
  );
}
