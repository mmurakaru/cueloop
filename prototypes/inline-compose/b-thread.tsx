/**
 * Variant B - "thread": the draft box opens inline under the anchored line
 * and SAVED notes stay expanded as cards in the document flow, stacking per
 * line. The plan reads like a review thread. One draft at a time.
 */

import React, { useMemo, useState } from "react";
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
  body: string[];
}

let nextId = 1;

export function App({ onExit }: { onExit: () => void }): React.ReactNode {
  const [cursor, setCursor] = useState(3);
  const [scroll, setScroll] = useState(0);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [notes, setNotes] = useState<Note[]>([]);
  const viewH = Math.max(10, (process.stdout.rows ?? 40) - 3);

  const items = useMemo(() => {
    const out: Item[] = [];
    for (let i = 0; i < PLAN.length; i++) {
      const l = PLAN[i]!;
      const lineNotes = notes.filter((n) => n.line === i);
      out.push({
        key: `l${i}`,
        height: 1,
        line: i,
        node: (
          <text key={`l${i}`} bg={i === cursor ? T.elevated : undefined}>
            <span fg={lineNotes.length > 0 ? T.accent : T.textDim}>{lineNotes.length > 0 ? " ┃ " : "   "}</span>
            <span fg={i === cursor ? T.text : lineFg(l.kind)}>{l.text || " "}</span>
          </text>
        ),
      });
      for (const [ni, n] of lineNotes.entries()) {
        out.push({
          key: `n${n.id}`,
          height: n.body.length + 2,
          line: i,
          node: (
            <box key={`n${n.id}`} style={{ height: n.body.length + 2, backgroundColor: T.panel, marginLeft: 3, paddingLeft: 1, flexDirection: "column" }}>
              <text>
                <span fg={T.accent}>┃ </span>
                <span fg={T.textDim}>
                  note {ni + 1}/{lineNotes.length} · you · x delete
                </span>
              </text>
              {n.body.map((b, bi) => (
                <text key={bi}>
                  <span fg={T.accent}>┃ </span>
                  <span fg={T.text}>{b || " "}</span>
                </text>
              ))}
              <text fg={T.textDim}> </text>
            </box>
          ),
        });
      }
      if (draft && draft.line === i) {
        out.push({
          key: "draft",
          height: draft.done.length + 3,
          line: i,
          node: (
            <box key="draft" style={{ height: draft.done.length + 3, backgroundColor: T.elevated, marginLeft: 3, paddingLeft: 1, flexDirection: "column" }}>
              <text fg={T.accent}>DRAFT NOTE · ⏎ save · ^j newline · esc cancel</text>
              {draft.done.map((b, bi) => (
                <text key={bi} fg={T.text}>
                  {b || " "}
                </text>
              ))}
              <input focused value={draft.text} onInput={(t: string) => setDraft({ ...draft, text: t })} placeholder="write a note..." />
            </box>
          ),
        });
      }
    }
    return out;
  }, [cursor, draft, notes]);

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

  const reveal = (line: number, last = false) => setScroll((s) => revealScroll(items, s, itemIndexForLine(line, last), viewH));

  useKeyboard((key) => {
    if (draft) {
      if (key.name === "escape") setDraft(null);
      else if (key.ctrl && key.name === "j") setDraft({ ...draft, done: [...draft.done, draft.text], text: "" });
      else if (key.name === "return") {
        const body = [...draft.done, draft.text].filter((l, i, a) => l.trim() !== "" || i < a.length - 1);
        if (body.join("").trim() !== "") setNotes((ns) => [...ns, { id: nextId++, line: draft.line, body }]);
        setDraft(null);
      }
      return;
    }
    if (key.name === "q") onExit();
    else if (key.name === "j" || key.name === "down") {
      const c = Math.min(PLAN.length - 1, cursor + 1);
      setCursor(c);
      reveal(c, true);
    } else if (key.name === "k" || key.name === "up") {
      const c = Math.max(0, cursor - 1);
      setCursor(c);
      reveal(c);
    } else if (key.name === "g" && !key.shift) {
      setCursor(0);
      setScroll(0);
    } else if ((key.name === "g" && key.shift) || key.name === "G") {
      setCursor(PLAN.length - 1);
      reveal(PLAN.length - 1, true);
    } else if (key.name === "c") {
      setDraft({ line: cursor, done: [], text: "" });
      setTimeout(() => reveal(cursor, true), 0);
    } else if (key.name === "x") {
      const lineNotes = notes.filter((n) => n.line === cursor);
      const last = lineNotes[lineNotes.length - 1];
      if (last) setNotes((ns) => ns.filter((n) => n.id !== last.id));
    }
  });

  return (
    <box style={{ flexDirection: "column", height: "100%", backgroundColor: T.bg }}>
      <text bg={T.panel} fg={T.accent}>
        {" B · THREAD - saved notes stay expanded in the flow · c compose · x delete · j/k · q quit "}
      </text>
      <box style={{ flexDirection: "column", flexGrow: 1, overflow: "hidden" }}>{visible(items, scroll, viewH).map((it) => it.node)}</box>
      <text bg={T.panel} fg={T.textDim}>
        {` notes: ${notes.length} · line ${cursor + 1}/${PLAN.length} `}
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
