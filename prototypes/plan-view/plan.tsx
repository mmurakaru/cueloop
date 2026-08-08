/**
 * Prototype: the plan view and the normal <-> edit switch.
 *
 * The primitive under test is the mode toggle. A single word-button sits at the
 * top-right of the plan sheet: it reads "Edit" in normal mode and "Done" while
 * editing, staying in the same spot - only the label and color change, and the
 * sheet itself transforms in place. "Cancel" is the discard escape hatch.
 *
 * Normal mode: read the plan, annotations paint the anchored lines, the rail
 * lists them by kind. Edit mode: a bare buffer with a line-number gutter over
 * the markdown source. On "Done" the edits commit and every annotation is
 * re-anchored against the new text; any whose quote vanished is marked orphaned
 * and a reconciliation banner appears - the hard part, surfaced.
 *
 * No far-left spaces panel: the multiplexer owns workspace switching, and a
 * sidebar is not a given in every terminal. Plan sheet + rail only. Iconless.
 */

import React, { useMemo, useState } from "react";
import { createCliRenderer } from "@opentui/core";
import { createRoot, useKeyboard } from "@opentui/react";
import { DARK as T } from "../../packages/client/src/theme";

// Markdown source of the plan. Editing mutates these lines.
const INITIAL_SRC = [
  "# Implementation Plan: Session Persistence",
  "",
  "## Context",
  "Review sessions currently live only in daemon memory, so they do not",
  "survive a restart. This plan persists each session to disk so a restarted",
  "daemon recovers in-flight reviews exactly where they stopped.",
  "",
  "## Phase 1: Storage layer",
  "All persistence lives in a new server/storage module that owns serialization",
  "and file layout. Every write goes through a temp file and an atomic rename so",
  "a crash mid-write can never leave a corrupt record behind.",
  "",
  "## Phase 2: Recovery",
  "On boot the daemon scans the sessions directory and rebuilds its index.",
  "Read-only recovery is the right call: bad records are skipped, not deleted.",
];

type Kind = "issue" | "question" | "nit" | "comment" | "looks_good";
const KIND_LABEL: Record<Kind, string> = { issue: "ISSUE", question: "QUESTION", nit: "NIT", comment: "COMMENT", looks_good: "LOOKS GOOD" };
const KIND_FG: Record<Kind, string> = { issue: T.red, question: T.blue, nit: T.textMuted, comment: T.textMuted, looks_good: T.green };

interface Note {
  id: number;
  kind: Kind;
  quote: string; // substring of a source line; the anchor
  body: string;
  blocking?: boolean;
  status: "pending" | "orphaned";
}

const INITIAL_NOTES: Note[] = [
  { id: 1, kind: "issue", blocking: true, quote: "atomic rename", body: "Durability of the atomic rename - confirm fsync before proceeding.", status: "pending" },
  { id: 2, kind: "question", quote: "server/storage", body: "Do we fsync the directory after the rename?", status: "pending" },
  { id: 3, kind: "nit", quote: "rebuilds its index", body: "Name the recovery report type.", status: "pending" },
  { id: 4, kind: "looks_good", quote: "Read-only recovery", body: "Read-only recovery is the right call.", status: "pending" },
];

function lineFg(text: string): string {
  if (text.startsWith("# ")) return T.accent;
  if (text.startsWith("## ")) return T.blue;
  return T.textMuted;
}
function display(text: string): string {
  if (text.startsWith("# ")) return text.slice(2);
  if (text.startsWith("## ")) return text.slice(3).toUpperCase();
  return text;
}

export function App({ onExit, rows }: { onExit: () => void; rows?: number }): React.ReactNode {
  const [src, setSrc] = useState<string[]>(INITIAL_SRC);
  const [notes, setNotes] = useState<Note[]>(INITIAL_NOTES);
  const [editing, setEditing] = useState(false);
  const [cursor, setCursor] = useState(0); // line index (both modes)
  const [buf, setBuf] = useState<string[]>(INITIAL_SRC); // edit buffer
  const [inLine, setInLine] = useState(false); // typing into the active line
  const [railTab, setRailTab] = useState<"review" | "agent">("review");
  const [selNote, setSelNote] = useState<number | null>(null);
  const [zone, setZone] = useState<"sheet" | "rail">("sheet");
  const [banner, setBanner] = useState<string | null>(null);
  const [rev, setRev] = useState(2);

  const viewH = Math.max(12, (rows ?? process.stdout.rows ?? 40) - 6);
  const orphaned = notes.filter((n) => n.status === "orphaned").length;

  // Re-anchor notes against text: a note whose quote is gone is orphaned.
  // Count synchronously from current state so the banner reflects this commit.
  const reconcile = (lines: string[]) => {
    const joined = lines.join("\n");
    let lost = 0;
    const next = notes.map((n) => {
      const found = joined.includes(n.quote);
      if (!found && n.status !== "orphaned") lost++;
      return { ...n, status: found ? ("pending" as const) : ("orphaned" as const) };
    });
    setNotes(next);
    return lost;
  };

  const enterEdit = () => {
    setBuf([...src]);
    setEditing(true);
    setZone("sheet");
    setInLine(false);
    setBanner(null);
  };
  const commitEdit = () => {
    setSrc([...buf]);
    setEditing(false);
    setInLine(false);
    setRev((r) => r + 1);
    const lost = reconcile(buf);
    setBanner(lost > 0 ? `${lost} annotation${lost > 1 ? "s" : ""} no longer match the new revision - the passage was removed. Reattach in Versions.` : null);
  };
  const cancelEdit = () => {
    setEditing(false);
    setInLine(false);
    setBuf([...src]);
  };

  useKeyboardHandlers({
    editing, inLine, zone, cursor, buf, notes, railTab, selNote,
    setCursor, setInLine, setBuf, setZone, setRailTab, setSelNote,
    enterEdit, commitEdit, cancelEdit, onExit, srcLen: (editing ? buf : src).length,
  });

  // ── sheet (normal) ────────────────────────────
  const sheetNormal = useMemo(() => {
    return src.map((text, i) => {
      const note = notes.find((n) => text.includes(n.quote) && n.status === "pending");
      const on = zone === "sheet" && i === cursor;
      const bg = note ? (note.kind === "issue" ? T.markCommentBg : T.cursorBg) : on ? T.elevated : undefined;
      if (text === "") return <text key={i}> </text>;
      return (
        <text key={i} bg={bg} onMouseUp={() => { setCursor(i); if (note) { setSelNote(note.id); setZone("rail"); } }}>
          <span fg={note ? (note.kind === "issue" ? T.red : T.accent) : lineFg(text)}>{display(text)}</span>
        </text>
      );
    });
  }, [src, notes, cursor, zone]);

  // ── sheet (edit buffer) ───────────────────────
  const gutterW = String(buf.length).length + 1;
  const sheetEdit = useMemo(() => {
    return buf.map((text, i) => {
      const on = i === cursor;
      const num = String(i + 1).padStart(gutterW, " ");
      return (
        <box key={i} style={{ flexDirection: "row", height: 1, backgroundColor: on ? T.elevated : undefined }}>
          <text fg={on ? T.accent : T.textDim}>{`${num} `}</text>
          {on && inLine ? (
            <input focused value={text} onInput={(t: string) => setBuf((b) => b.map((l, j) => (j === i ? t : l)))} />
          ) : (
            <text fg={T.textMuted}>{text || " "}</text>
          )}
        </box>
      );
    });
  }, [buf, cursor, inLine, gutterW]);

  const scrollStart = Math.max(0, Math.min(cursor - Math.floor(viewH / 2), (editing ? buf : src).length - viewH));
  const sheet = (editing ? sheetEdit : sheetNormal).slice(scrollStart, scrollStart + viewH);

  return (
    <box style={{ flexDirection: "column", height: "100%", backgroundColor: T.bg }}>
      {/* breadcrumb */}
      <box style={{ flexDirection: "row", height: 1, backgroundColor: T.panel }}>
        <text fg={T.accent}> cueloop </text>
        <text fg={T.textDim}>{`· Session persistence · v${rev} / `}</text>
        <text fg={T.text}>plan.md</text>
        <text fg={T.textDim}>{editing ? " · editing" : ` · v${rev} · block ${cursor + 1}/${src.length}`}</text>
        <box style={{ flexGrow: 1 }} />
        <box onMouseUp={() => setOpenSettings()}>
          <text fg={T.textDim}> settings </text>
        </box>
      </box>

      {/* body: sheet column (header + banner + content) beside a full-height rail */}
      <box style={{ flexDirection: "row", flexGrow: 1 }}>
        <box style={{ flexDirection: "column", flexGrow: 1, paddingLeft: 1, paddingRight: 1 }}>
          {/* sheet header: submitted-by + the Edit/Done toggle (top-right of the sheet) */}
          <box style={{ flexDirection: "row", height: 1 }}>
            {editing ? (
              <text fg={T.textDim}>editing plan source · esc or Done to commit</text>
            ) : (
              <text fg={T.textDim}>
                <span>submitted by </span>
                <span fg={T.textMuted}>agent/worker-3</span>
                <span>{` · revision ${rev} · `}</span>
                <span fg={T.green}>{`v${rev - 1}→v${rev} +5 -1`}</span>
              </text>
            )}
            <box style={{ flexGrow: 1 }} />
            {editing ? (
              <>
                <box onMouseUp={commitEdit}>
                  <text fg={T.accent}> Done </text>
                </box>
                <box onMouseUp={cancelEdit}>
                  <text fg={T.textDim}> Cancel </text>
                </box>
              </>
            ) : (
              <box onMouseUp={enterEdit}>
                <text fg={T.textDim}> Edit </text>
              </box>
            )}
          </box>

          {/* reconciliation banner */}
          {banner ? (
            <box style={{ flexDirection: "row", height: 1, backgroundColor: T.markCommentBg }}>
              <text fg={T.red}>{banner}</text>
            </box>
          ) : null}

          {sheet}
        </box>

        {/* rail */}
        <box style={{ flexDirection: "column", width: 36, backgroundColor: T.panel }}>
          <box style={{ flexDirection: "row", height: 1, paddingLeft: 1 }}>
            <box onMouseUp={() => setRailTab("review")}>
              <text fg={railTab === "review" ? T.accent : T.textDim}>{`Review (${notes.length})`}</text>
            </box>
            <text fg={T.textDim}>{"   "}</text>
            <box onMouseUp={() => setRailTab("agent")}>
              <text fg={railTab === "agent" ? T.accent : T.textDim}>Agent</text>
            </box>
          </box>
          <box style={{ height: 1 }} />
          {railTab === "review" ? (
            <box style={{ flexDirection: "column", flexGrow: 1 }}>
              {notes.map((n) => {
                const sel = n.id === selNote;
                const orphan = n.status === "orphaned";
                return (
                  <box key={n.id} style={{ flexDirection: "column", marginBottom: 1, paddingLeft: 1, backgroundColor: sel ? T.elevated : undefined }} onMouseUp={() => { setSelNote(n.id); setZone("rail"); }}>
                    <text>
                      <span fg={KIND_FG[n.kind]}>{KIND_LABEL[n.kind]}</span>
                      {n.blocking ? <span fg={T.red}>{" · BLOCKING"}</span> : null}
                      <span fg={T.textDim}>{orphan ? " · ORPHANED" : " · pending"}</span>
                    </text>
                    <text fg={orphan ? T.textDim : T.textMuted}>{`${orphan ? "(passage removed) " : ""}${n.body.slice(0, 30)}`}</text>
                  </box>
                );
              })}
              <box style={{ flexGrow: 1 }} />
              <box style={{ height: 1, backgroundColor: T.accent }}>
                <text fg={T.accentInk}>{`  Submit review (${notes.length})  `}</text>
              </box>
            </box>
          ) : (
            <box style={{ flexDirection: "column", flexGrow: 1, paddingLeft: 1 }}>
              <text fg={T.textDim}>agent/worker-3</text>
              <text fg={T.textMuted}>waiting for the verdict</text>
              <text fg={T.textDim}>last: submitted revision 2</text>
            </box>
          )}
        </box>
      </box>

      {/* status */}
      <box style={{ flexDirection: "row", height: 1, backgroundColor: T.panel }}>
        <text fg={T.textDim}>
          {editing
            ? inLine
              ? " typing · esc line done · Done commit "
              : " j/k line · i edit line · d delete line · Done commit · Cancel discard "
            : " e edit · c comment · d cut · tab rail · q quit "}
        </text>
      </box>
    </box>
  );
}

// settings hook placeholder for the prototype (kept minimal)
function setOpenSettings() {}

interface HK {
  editing: boolean;
  inLine: boolean;
  zone: "sheet" | "rail";
  cursor: number;
  buf: string[];
  notes: Note[];
  railTab: "review" | "agent";
  selNote: number | null;
  srcLen: number;
  setCursor: (f: (c: number) => number) => void;
  setInLine: (b: boolean) => void;
  setBuf: (f: (b: string[]) => string[]) => void;
  setZone: (f: (z: "sheet" | "rail") => "sheet" | "rail") => void;
  setRailTab: (f: (t: "review" | "agent") => "review" | "agent") => void;
  setSelNote: (n: number | null) => void;
  enterEdit: () => void;
  commitEdit: () => void;
  cancelEdit: () => void;
  onExit: () => void;
}

function useKeyboardHandlers(h: HK): void {
  useKeyboard((key) => {
    if (h.editing) {
      if (h.inLine) {
        // The line input owns typing; the buffer updates live via onInput.
        if (key.name === "escape" || key.name === "return") h.setInLine(false);
        return;
      }
      if (key.name === "escape") h.commitEdit();
      else if (key.name === "j" || key.name === "down") h.setCursor((c) => Math.min(h.buf.length - 1, c + 1));
      else if (key.name === "k" || key.name === "up") h.setCursor((c) => Math.max(0, c - 1));
      else if (key.name === "i" || key.name === "return") h.setInLine(true);
      else if (key.name === "d") {
        h.setBuf((b) => (b.length > 1 ? b.filter((_, i) => i !== h.cursor) : b));
        h.setCursor((c) => Math.max(0, Math.min(c, h.buf.length - 2)));
      }
      return;
    }
    if (key.name === "q") h.onExit();
    else if (key.name === "e") h.enterEdit();
    else if (key.name === "tab") h.setZone((z) => (z === "sheet" ? "rail" : "sheet"));
    else if (h.zone === "rail") {
      const idx = h.notes.findIndex((n) => n.id === h.selNote);
      if (key.name === "j" || key.name === "down") h.setSelNote(h.notes[Math.min(h.notes.length - 1, idx + 1)]?.id ?? null);
      else if (key.name === "k" || key.name === "up") h.setSelNote(h.notes[Math.max(0, idx - 1)]?.id ?? null);
    } else {
      if (key.name === "j" || key.name === "down") h.setCursor((c) => Math.min(h.srcLen - 1, c + 1));
      else if (key.name === "k" || key.name === "up") h.setCursor((c) => Math.max(0, c - 1));
    }
  });
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
