/**
 * Variant D - "panel": the guide grammar.
 * - Selecting a line and composing paints the anchor highlight IMMEDIATELY;
 *   cancel un-paints it.
 * - The compose box is a bordered card in the document flow with mouse-
 *   clickable Save / Cancel buttons.
 * - After save the comment text lives ONLY in the side rail; the document
 *   keeps just the kind-colored highlight on the anchored line.
 * - Selection is symmetric: click a highlight -> its card selects in the
 *   rail; select a card -> the document scrolls there with a 2s focus pulse.
 * - Editing happens in the rail card (e), never in the document.
 * - d = one-keystroke deletion mark (no composer), c = comment (composer).
 */

import React, { useMemo, useRef, useState } from "react";
import { createCliRenderer } from "@opentui/core";
import { createRoot, useKeyboard } from "@opentui/react";
import { PLAN, T, lineFg, revealScroll, visible, type Item } from "./common";

interface Draft {
  line: number;
  done: string[];
  text: string;
}
interface Note {
  id: number;
  line: number;
  kind: "comment" | "cut";
  quote: string;
  body: string[];
}

const HL_COMMENT = "#4a3f22";
const HL_CUT = "#4a2626";
const HL_PULSE = "#6b5a2e";

let nextId = 1;

export function App({ onExit, rows }: { onExit: () => void; rows?: number }): React.ReactNode {
  const [cursor, setCursor] = useState(3);
  const [scroll, setScroll] = useState(0);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [notes, setNotes] = useState<Note[]>([]);
  const [focus, setFocus] = useState<"doc" | "rail">("doc");
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [pulseId, setPulseId] = useState<number | null>(null);
  const [editing, setEditing] = useState<{ id: number; text: string } | null>(null);
  const pulseTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const viewH = Math.max(10, (rows ?? process.stdout.rows ?? 40) - 3);

  const save = (d: Draft) => {
    const body = [...d.done, d.text].filter((l, i, a) => l.trim() !== "" || i < a.length - 1);
    if (body.join("").trim() !== "") {
      const n: Note = { id: nextId++, line: d.line, kind: "comment", quote: PLAN[d.line]!.text, body };
      setNotes((ns) => [...ns, n]);
      setSelectedId(n.id);
    }
    setDraft(null);
  };

  const pulse = (id: number) => {
    setPulseId(id);
    if (pulseTimer.current) clearTimeout(pulseTimer.current);
    pulseTimer.current = setTimeout(() => setPulseId(null), 2000);
  };

  const selectFromRail = (n: Note) => {
    setSelectedId(n.id);
    pulse(n.id);
    setCursor(n.line);
    setScroll((s) => revealScroll(items, s, itemIndexForLine(n.line), viewH));
  };

  const items = useMemo(() => {
    const out: Item[] = [];
    for (let i = 0; i < PLAN.length; i++) {
      const l = PLAN[i]!;
      const lineNote = notes.find((n) => n.line === i);
      const pending = draft?.line === i;
      const pulsing = lineNote && pulseId === lineNote.id;
      const bg = pulsing ? HL_PULSE : lineNote ? (lineNote.kind === "cut" ? HL_CUT : HL_COMMENT) : pending ? HL_COMMENT : i === cursor && focus === "doc" ? T.elevated : undefined;
      out.push({
        key: `l${i}`,
        height: 1,
        line: i,
        node: (
          <text
            key={`l${i}`}
            bg={bg}
            onMouseUp={() => {
              setCursor(i);
              if (lineNote) {
                setSelectedId(lineNote.id);
                setFocus("rail");
              }
            }}
          >
            <span fg={i === cursor && focus === "doc" ? T.accent : T.textDim}>{i === cursor && focus === "doc" ? " ▸ " : "   "}</span>
            <span fg={lineNote?.kind === "cut" ? T.red : i === cursor ? T.text : lineFg(l.kind)}>{l.text || " "}</span>
          </text>
        ),
      });
      if (pending && draft) {
        out.push({
          key: "draft",
          height: draft.done.length + 5,
          line: i,
          node: (
            <box
              key="draft"
              style={{
                height: draft.done.length + 4,
                marginLeft: 3,
                marginRight: 1,
                border: true,
                borderStyle: "rounded",
                borderColor: T.accent,
                backgroundColor: T.elevated,
                flexDirection: "column",
                paddingLeft: 1,
              }}
              title={` draft note - L${i + 1} `}
            >
              {draft.done.map((b, bi) => (
                <text key={bi} fg={T.text}>
                  {b || " "}
                </text>
              ))}
              <input focused value={draft.text} onInput={(t: string) => setDraft((d) => (d ? { ...d, text: t } : d))} placeholder="write a note..." />
              <box style={{ flexDirection: "row", height: 1 }}>
                <box style={{ backgroundColor: T.accent, marginRight: 2 }} onMouseUp={() => draft && save(draft)}>
                  <text fg={T.accentInk}>{" Save ⏎ "}</text>
                </box>
                <box style={{ backgroundColor: T.panel }} onMouseUp={() => setDraft(null)}>
                  <text fg={T.textMuted}>{" Cancel esc "}</text>
                </box>
              </box>
            </box>
          ),
        });
      }
    }
    return out;
  }, [cursor, draft, notes, focus, pulseId]);

  const itemIndexForLine = (line: number, last = false): number => {
    let idx = 0;
    for (let i = 0; i < items.length; i++) {
      if (items[i]!.line === line) {
        idx = i;
        if (!last) return i;
      }
      if (items[i]!.line > line) break;
    }
    return idx;
  };

  useKeyboard((key) => {
    if (draft) {
      if (key.name === "escape") setDraft(null);
      else if (key.ctrl && key.name === "j") setDraft({ ...draft, done: [...draft.done, draft.text], text: "" });
      else if (key.name === "return") save(draft);
      return;
    }
    if (editing) {
      if (key.name === "escape") setEditing(null);
      else if (key.name === "return") {
        setNotes((ns) => ns.map((n) => (n.id === editing.id ? { ...n, body: [editing.text] } : n)));
        setEditing(null);
      }
      return;
    }
    if (key.name === "q") onExit();
    else if (key.name === "tab") setFocus((f) => (f === "doc" ? "rail" : "doc"));
    else if (focus === "rail") {
      const idx = notes.findIndex((n) => n.id === selectedId);
      if (key.name === "j" || key.name === "down") {
        const n = notes[Math.min(notes.length - 1, idx + 1)];
        if (n) selectFromRail(n);
      } else if (key.name === "k" || key.name === "up") {
        const n = notes[Math.max(0, idx - 1)];
        if (n) selectFromRail(n);
      } else if (key.name === "e" && idx >= 0) {
        const n = notes[idx]!;
        if (n.kind === "comment") setEditing({ id: n.id, text: n.body.join(" ") });
      } else if (key.name === "x" && idx >= 0) {
        setNotes((ns) => ns.filter((n) => n.id !== selectedId));
        setSelectedId(null);
      } else if (key.name === "return" && idx >= 0) {
        selectFromRail(notes[idx]!);
        setFocus("doc");
      }
    } else {
      if (key.name === "j" || key.name === "down") {
        const c = Math.min(PLAN.length - 1, cursor + 1);
        setCursor(c);
        setScroll((s) => revealScroll(items, s, itemIndexForLine(c, true), viewH));
      } else if (key.name === "k" || key.name === "up") {
        const c = Math.max(0, cursor - 1);
        setCursor(c);
        setScroll((s) => revealScroll(items, s, itemIndexForLine(c), viewH));
      } else if (key.name === "g" && !key.shift) {
        setCursor(0);
        setScroll(0);
      } else if ((key.name === "g" && key.shift) || key.name === "G") {
        setCursor(PLAN.length - 1);
        setScroll((s) => revealScroll(items, s, itemIndexForLine(PLAN.length - 1, true), viewH));
      } else if (key.name === "c" && !notes.some((n) => n.line === cursor)) {
        setDraft({ line: cursor, done: [], text: "" });
        setTimeout(() => setScroll((s) => revealScroll(items, s, itemIndexForLine(cursor, true), viewH)), 0);
      } else if (key.name === "d" && !notes.some((n) => n.line === cursor)) {
        const n: Note = { id: nextId++, line: cursor, kind: "cut", quote: PLAN[cursor]!.text, body: ["Remove this."] };
        setNotes((ns) => [...ns, n]);
        setSelectedId(n.id);
      }
    }
  });

  return (
    <box style={{ flexDirection: "column", height: "100%", backgroundColor: T.bg }}>
      <text bg={T.panel} fg={T.accent}>
        {" D · PANEL - highlight in doc, text in rail · c comment · d cut · tab rail · e edit · q quit "}
      </text>
      <box style={{ flexDirection: "row", flexGrow: 1, overflow: "hidden" }}>
        <box style={{ flexDirection: "column", flexGrow: 1, overflow: "hidden" }}>{visible(items, scroll, viewH).map((it) => it.node)}</box>
        <box style={{ flexDirection: "column", width: 34, backgroundColor: T.panel, paddingLeft: 1, overflow: "hidden" }}>
          <text fg={T.textMuted}>{`ANNOTATIONS (${notes.length})`}</text>
          {notes.map((n) => {
            const sel = n.id === selectedId;
            const isEdit = editing?.id === n.id;
            return (
              <box
                key={n.id}
                style={{ flexDirection: "column", backgroundColor: sel ? T.elevated : undefined, marginTop: 1, paddingLeft: 1 }}
                onMouseUp={() => {
                  selectFromRail(n);
                  setFocus("rail");
                }}
              >
                <text fg={n.kind === "cut" ? T.red : T.accent}>
                  {n.kind === "cut" ? "Deletion" : "Comment"}
                  <span fg={T.textDim}> · you · L{n.line + 1}</span>
                </text>
                <text fg={T.textDim}>{`"${n.quote.slice(0, 28)}${n.quote.length > 28 ? "..." : ""}"`}</text>
                {isEdit ? (
                  <input focused value={editing.text} onInput={(t: string) => setEditing((e) => (e ? { ...e, text: t } : e))} />
                ) : (
                  n.body.map((b, bi) => (
                    <text key={bi} fg={T.textMuted}>
                      {b.slice(0, 30) || " "}
                    </text>
                  ))
                )}
              </box>
            );
          })}
          {notes.length === 0 ? <text fg={T.textDim}>{"no annotations yet"}</text> : null}
        </box>
      </box>
      <text bg={T.panel} fg={T.textDim}>
        {focus === "rail" ? " rail: j/k select · e edit · x delete · ⏎ jump · tab back " : ` doc: line ${cursor + 1}/${PLAN.length} · click a highlight to open its card `}
      </text>
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
