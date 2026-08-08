/**
 * Prototype v2: the selection primitive on the renderer's native selection.
 *
 * One selection object, two drivers, coexisting:
 *   Mouse    - plain drag over the text; the renderer paints the selection
 *              natively (the multiplexer forwards the drag because the app
 *              has mouse reporting on - it only runs its own select-and-copy
 *              when the inner app does not want the mouse).
 *   Keyboard - h/l word, j/k line move the cursor; v anchors the native
 *              selection at the cursor and movement extends it; esc clears.
 *
 * c comments on whatever is selected (or the cursor word when nothing is);
 * the quote comes from getSelectedText, char-precise, exactly what the
 * schema's quote anchors want. While the compose box is open the marked text
 * stays painted. Saved notes paint their text in the document; bodies live
 * in the rail. Iconless.
 */

import React, { useMemo, useRef, useState } from "react";
import { createCliRenderer, type TextRenderable } from "@opentui/core";
import { createRoot, useKeyboard, useRenderer } from "@opentui/react";
import { DARK as THEME } from "../../packages/client/src/theme";

const SOURCE_LINES = [
  "# Implementation Plan: Session Persistence",
  "",
  "## Context",
  "Review sessions currently live only in daemon memory, so they do not",
  "survive a restart. This plan persists each session to disk so a restarted",
  "daemon recovers in-flight reviews exactly where they stopped.",
  "",
  "## Phase 1: Storage layer",
  "All persistence lives in a new server/storage module that owns serialization",
  "and file layout. Every write goes through a temp file and an atomic rename.",
] as const;

interface WordToken {
  text: string;
  start: number;
}
function tokenize(line: string): WordToken[] {
  const tokens: WordToken[] = [];
  const wordPattern = /\S+/g;
  let match: RegExpExecArray | null;
  while ((match = wordPattern.exec(line))) tokens.push({ text: match[0], start: match.index });
  return tokens;
}
const LINE_TOKENS = SOURCE_LINES.map(tokenize);

function shownLine(rawLine: string): string {
  if (rawLine.startsWith("# ")) return rawLine.slice(2);
  if (rawLine.startsWith("## ")) return rawLine.slice(3).toUpperCase();
  return rawLine;
}
function lineColor(rawLine: string): string {
  if (rawLine.startsWith("# ")) return THEME.accent;
  if (rawLine.startsWith("## ")) return THEME.blue;
  return THEME.textMuted;
}
/** Char offset shift between the raw source and what is shown. */
function shownShift(rawLine: string): number {
  if (rawLine.startsWith("# ")) return -2;
  if (rawLine.startsWith("## ")) return -3;
  return 0;
}

/** [start, end) char range in a line's shown text. */
type CharRange = [number, number];

interface Note {
  id: number;
  quote: string;
  body: string;
  /** line index -> painted range, for the document-side highlight */
  marks: Map<number, CharRange>;
  endLine: number;
}
let nextNoteId = 1;

export function App({ onExit }: { onExit: () => void }): React.ReactNode {
  const renderer = useRenderer();
  const lineRefs = useRef(new Map<number, TextRenderable>());
  const [cursor, setCursor] = useState<{ line: number; word: number }>({ line: 3, word: 0 });
  const [selecting, setSelecting] = useState(false);
  const [notes, setNotes] = useState<Note[]>([]);
  const [compose, setCompose] = useState<{ quote: string; marks: Map<number, CharRange>; endLine: number; text: string } | null>(null);
  const [flash, setFlash] = useState("");

  const wordScreenPosition = (lineIndex: number, wordIndex: number, atWordEnd = false): { x: number; y: number } | null => {
    const lineRef = lineRefs.current.get(lineIndex);
    const token = LINE_TOKENS[lineIndex]?.[wordIndex];
    if (!lineRef || !token) return null;
    const column = Math.max(0, token.start + shownShift(SOURCE_LINES[lineIndex]!) + (atWordEnd ? token.text.length - 1 : 0));
    return { x: lineRef.x + column, y: lineRef.y };
  };

  const driveSelection = (lineIndex: number, wordIndex: number, isAnchor: boolean) => {
    const position = wordScreenPosition(lineIndex, wordIndex, !isAnchor);
    const lineRef = lineRefs.current.get(lineIndex);
    if (!position || !lineRef) return;
    if (isAnchor) renderer.startSelection(lineRef, position.x, position.y);
    else renderer.updateSelection(lineRef, position.x + 1, position.y);
  };

  /** Selected text + per-line ranges, read from the native selection. */
  const readSelection = () => {
    if (!renderer.hasSelection) return null;
    const marks = new Map<number, CharRange>();
    const quoteParts: string[] = [];
    let endLine = cursor.line;
    for (const [lineIndex, lineRef] of lineRefs.current) {
      const selectedText = lineRef.getSelectedText().trim();
      if (selectedText !== "") {
        const shown = shownLine(SOURCE_LINES[lineIndex]!);
        const foundAt = Math.max(0, shown.indexOf(selectedText));
        marks.set(lineIndex, [foundAt, foundAt + selectedText.length]);
        quoteParts.push(selectedText);
        endLine = Math.max(endLine, lineIndex);
      }
    }
    if (quoteParts.length === 0) return null;
    return { quote: quoteParts.join(" "), marks, endLine };
  };

  const startCompose = () => {
    const selection = readSelection();
    if (selection) {
      renderer.clearSelection();
      setSelecting(false);
      setCompose({ ...selection, text: "" });
      return;
    }
    const token = LINE_TOKENS[cursor.line]?.[cursor.word];
    if (!token) return;
    const start = token.start + shownShift(SOURCE_LINES[cursor.line]!);
    const marks = new Map<number, CharRange>([[cursor.line, [start, start + token.text.length]]]);
    setCompose({ quote: token.text, marks, endLine: cursor.line, text: "" });
  };

  const saveCompose = () => {
    setCompose((current) => {
      if (current && current.text.trim() !== "") {
        setNotes((existing) => [...existing, { id: nextNoteId++, quote: current.quote, body: current.text, marks: current.marks, endLine: current.endLine }]);
        setFlash("annotation saved");
      }
      return null;
    });
  };

  const firstLineWithWords = (fromLine: number, direction: number): number => {
    let lineIndex = fromLine;
    while (lineIndex >= 0 && lineIndex < SOURCE_LINES.length) {
      if (LINE_TOKENS[lineIndex]!.length > 0) return lineIndex;
      lineIndex += direction;
    }
    return Math.max(0, Math.min(SOURCE_LINES.length - 1, fromLine));
  };

  const move = (lineDelta: number, wordDelta: number) => {
    setCursor((current) => {
      let { line, word } = current;
      if (lineDelta !== 0) {
        line = firstLineWithWords(Math.max(0, Math.min(SOURCE_LINES.length - 1, line + lineDelta)), lineDelta > 0 ? 1 : -1);
        word = Math.min(word, Math.max(0, LINE_TOKENS[line]!.length - 1));
      } else {
        word += wordDelta;
        if (word < 0) {
          const previousLine = firstLineWithWords(line - 1, -1);
          if (previousLine !== line) {
            line = previousLine;
            word = LINE_TOKENS[previousLine]!.length - 1;
          } else word = 0;
        } else if (word >= LINE_TOKENS[line]!.length) {
          const nextLine = firstLineWithWords(line + 1, 1);
          if (nextLine !== line) {
            line = nextLine;
            word = 0;
          } else word = LINE_TOKENS[line]!.length - 1;
        }
      }
      if (selecting) driveSelection(line, word, false);
      return { line, word };
    });
  };

  useKeyboard((key) => {
    if (compose) {
      if (key.name === "escape") setCompose(null);
      else if (key.name === "return") saveCompose();
      return;
    }
    if (key.name === "q") onExit();
    else if (key.name === "h" || key.name === "left") move(0, -1);
    else if (key.name === "l" || key.name === "right") move(0, 1);
    else if (key.name === "j" || key.name === "down") move(1, 0);
    else if (key.name === "k" || key.name === "up") move(-1, 0);
    else if (key.name === "v") {
      if (selecting) setSelecting(false);
      else {
        driveSelection(cursor.line, cursor.word, true);
        driveSelection(cursor.line, cursor.word, false);
        setSelecting(true);
      }
    } else if (key.name === "escape") {
      renderer.clearSelection();
      setSelecting(false);
    } else if (key.name === "c") startCompose();
  });

  const lines = useMemo(() => {
    const rendered: React.ReactNode[] = [];
    for (let lineIndex = 0; lineIndex < SOURCE_LINES.length; lineIndex++) {
      const rawLine = SOURCE_LINES[lineIndex]!;
      if (rawLine === "") {
        rendered.push(<box key={lineIndex} style={{ height: 1 }} />);
      } else {
        const shown = shownLine(rawLine);
        // Ranges to paint: the pending compose span (selection-style, so the
        // marked text stays marked while the box is open), saved-note marks,
        // then the cursor word on top.
        const pendingRange = compose?.marks.get(lineIndex) ?? null;
        const noteRanges = notes.filter((note) => note.marks.has(lineIndex)).map((note) => note.marks.get(lineIndex)!);
        const cursorToken = LINE_TOKENS[lineIndex]![cursor.word];
        const shift = shownShift(rawLine);
        const cursorRange: CharRange | null =
          !compose && cursor.line === lineIndex && cursorToken ? [cursorToken.start + shift, cursorToken.start + shift + cursorToken.text.length] : null;
        const cutPoints = new Set<number>([0, shown.length]);
        for (const [rangeStart, rangeEnd] of noteRanges) {
          cutPoints.add(rangeStart);
          cutPoints.add(rangeEnd);
        }
        if (pendingRange) {
          cutPoints.add(pendingRange[0]);
          cutPoints.add(pendingRange[1]);
        }
        if (cursorRange) {
          cutPoints.add(cursorRange[0]);
          cutPoints.add(cursorRange[1]);
        }
        const edges = [...cutPoints].sort((left, right) => left - right);
        const spans: React.ReactNode[] = [];
        for (let edgeIndex = 0; edgeIndex < edges.length - 1; edgeIndex++) {
          const segmentStart = edges[edgeIndex]!;
          const segmentEnd = edges[edgeIndex + 1]!;
          if (segmentStart >= segmentEnd) continue;
          const inPending = pendingRange && segmentStart >= pendingRange[0] && segmentEnd <= pendingRange[1];
          const inNote = noteRanges.some(([rangeStart, rangeEnd]) => segmentStart >= rangeStart && segmentEnd <= rangeEnd);
          const underCursor = cursorRange && segmentStart >= cursorRange[0] && segmentEnd <= cursorRange[1];
          spans.push(
            <span
              key={edgeIndex}
              bg={inPending ? THEME.accent : underCursor ? THEME.elevated : inNote ? THEME.markCommentBg : undefined}
              fg={inPending ? THEME.accentInk : underCursor ? THEME.text : inNote ? THEME.accent : lineColor(rawLine)}
            >
              {shown.slice(segmentStart, segmentEnd)}
            </span>,
          );
        }
        rendered.push(
          <text
            key={lineIndex}
            selectable
            selectionBg={THEME.accent}
            selectionFg={THEME.accentInk}
            ref={(lineRef: TextRenderable | null) => {
              if (lineRef) lineRefs.current.set(lineIndex, lineRef);
              else lineRefs.current.delete(lineIndex);
            }}
          >
            {spans}
          </text>,
        );
      }
      if (compose && compose.endLine === lineIndex) {
        rendered.push(
          <box
            key={`compose-${lineIndex}`}
            style={{ height: 3, marginRight: 2, border: true, borderStyle: "rounded", borderColor: THEME.accent, backgroundColor: THEME.elevated, flexDirection: "column", paddingLeft: 1 }}
            title={` comment on "${compose.quote.slice(0, 44)}${compose.quote.length > 44 ? "..." : ""}" `}
          >
            <input focused value={compose.text} onInput={(typed: string) => setCompose((current) => (current ? { ...current, text: typed } : current))} placeholder="write a note... (enter save · esc cancel)" />
          </box>,
        );
      }
    }
    return rendered;
  }, [cursor, selecting, notes, compose]);

  return (
    <box style={{ flexDirection: "column", height: "100%", backgroundColor: THEME.bg }}>
      <box style={{ flexDirection: "row", height: 1, backgroundColor: THEME.panel }}>
        <text fg={THEME.accent}> cueloop </text>
        <text fg={THEME.textDim}>· plan.md · drag or v to select, c to comment</text>
      </box>
      <box style={{ flexDirection: "row", flexGrow: 1 }}>
        <box style={{ flexDirection: "column", flexGrow: 1, paddingLeft: 1, paddingRight: 1 }}>{lines}</box>
        <box style={{ flexDirection: "column", width: 34, backgroundColor: THEME.panel, paddingLeft: 1 }}>
          <text fg={THEME.accent}>{`Review (${notes.length})`}</text>
          <box style={{ height: 1 }} />
          {notes.length === 0 ? <text fg={THEME.textDim}>select a span and press c</text> : null}
          {notes.map((note) => (
            <box key={note.id} style={{ flexDirection: "column", marginBottom: 1 }}>
              <text fg={THEME.textMuted}>COMMENT</text>
              <text fg={THEME.textDim}>{`"${note.quote.slice(0, 28)}${note.quote.length > 28 ? "..." : ""}"`}</text>
              <text fg={THEME.textMuted}>{note.body.slice(0, 30)}</text>
            </box>
          ))}
        </box>
      </box>
      <box style={{ flexDirection: "row", height: 1, backgroundColor: THEME.panel }}>
        <text fg={THEME.textDim}>
          {compose ? " typing · enter save · esc cancel " : selecting ? " extending selection · h/l/j/k · c comment · v stop · esc clear " : ` ${flash || "h/l word · j/k line · v select · drag selects · c comment · q quit"} `}
        </text>
      </box>
    </box>
  );
}

if (import.meta.main) {
  const renderer = await createCliRenderer({ enableMouseMovement: true });
  createRoot(renderer).render(
    <App
      onExit={() => {
        renderer.destroy();
        process.exit(0);
      }}
    />,
  );
}
