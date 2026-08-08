/**
 * The projection pipeline (#22): parse → display blocks (base vs working
 * copy reconciled) → styled runs → wrapped lines. Pure functions - the TUI
 * renders the output, tests assert on it directly. One planning layer:
 * rendering, navigation, and selection all derive from this module.
 */

import {
  lcsDiff,
  parseBlocks,
  resolveAnchor,
  wordDiff,
  type Annotation,
  type Block,
} from "@cueloop/schema";

// ── display model ─────────────────────────────

export type DisplayType = "same" | "mod" | "del" | "add";

export interface DisplayBlock {
  type: DisplayType;
  kind: Block["kind"];
  /** Block in the working copy (absent for del). */
  work?: Block;
  /** Block in the submitted revision (absent for add). */
  base?: Block;
  oliNum?: number;
}

export function displayText(d: DisplayBlock): string {
  return (d.work ?? d.base)!.text;
}

/** Word-overlap similarity gate: an unrelated cut + insert must not merge. */
function similar(a: Block, b: Block): boolean {
  if (a.kind !== b.kind) return false;
  const words = (t: string) => new Set(t.toLowerCase().split(/\s+/).filter(Boolean));
  const wa = words(a.text);
  const wb = words(b.text);
  let inter = 0;
  for (const w of wa) if (wb.has(w)) inter++;
  const union = wa.size + wb.size - inter;
  return union === 0 ? true : inter / union >= 0.3;
}

/** Reconcile base blocks vs working blocks into the display list. */
export function buildDisplay(baseContent: string, workingContent?: string): DisplayBlock[] {
  const baseBlocks = parseBlocks(baseContent);
  if (workingContent === undefined) {
    const out: DisplayBlock[] = baseBlocks.map((b) => ({ type: "same", kind: b.kind, work: b, base: b }));
    numberOlis(out);
    return out;
  }
  const workBlocks = parseBlocks(workingContent);
  const sig = (b: Block) => b.kind + "\0" + b.text;
  const ops = lcsDiff(baseBlocks, workBlocks, (x, y) => sig(x) === sig(y));
  const out: DisplayBlock[] = [];
  let k = 0;
  while (k < ops.length) {
    const op = ops[k]!;
    if (op.t === "ctx") {
      out.push({ type: "same", kind: op.b!.kind, work: op.b, base: op.a });
      k++;
      continue;
    }
    const dels: Block[] = [];
    const adds: Block[] = [];
    while (k < ops.length && ops[k]!.t !== "ctx") {
      const o = ops[k]!;
      if (o.t === "del") dels.push(o.a!);
      else adds.push(o.b!);
      k++;
    }
    let di = 0;
    let ai = 0;
    while (di < dels.length && ai < adds.length) {
      if (similar(dels[di]!, adds[ai]!)) {
        out.push({ type: "mod", kind: adds[ai]!.kind, base: dels[di]!, work: adds[ai]! });
        di++;
        ai++;
      } else if (dels.length - di >= adds.length - ai) {
        out.push({ type: "del", kind: dels[di]!.kind, base: dels[di]! });
        di++;
      } else {
        out.push({ type: "add", kind: adds[ai]!.kind, work: adds[ai]! });
        ai++;
      }
    }
    while (di < dels.length) out.push({ type: "del", kind: dels[di]!.kind, base: dels[di++]! });
    while (ai < adds.length) out.push({ type: "add", kind: adds[ai]!.kind, work: adds[ai++]! });
  }
  numberOlis(out);
  return out;
}

function numberOlis(disp: DisplayBlock[]): void {
  let run = 0;
  for (const d of disp) {
    if (d.kind === "oli") d.oliNum = ++run;
    else run = 0;
  }
}

// ── marks (annotation highlights + keyboard span) ──

export type RunRole =
  | "plain"
  | "ins"
  | "del"
  | "mark-comment"
  | "mark-suggestion"
  | "kspan"
  | "mark-focus";

export interface StyleRun {
  text: string;
  role: RunRole;
  /** Offset of this run in the block's working text; null for del runs. */
  start: number | null;
  annotationId?: string;
}

export interface Mark {
  start: number;
  end: number;
  role: RunRole;
  annotationId?: string;
}

/**
 * Resolve annotations against the working blocks and group marks per display
 * index. Working blocks are the blocks of (workingCopy ?? artifact) - the
 * same list buildDisplay derived work entries from.
 */
export function marksByDisplay(
  annotations: Annotation[],
  display: DisplayBlock[],
  focusedId?: string,
): Map<number, Mark[]> {
  // block list in "work space": display entries that carry a work block, in order
  const workEntries = display
    .map((d, dispIdx) => ({ d, dispIdx }))
    .filter((e) => e.d.work !== undefined);
  const workBlocks = workEntries.map((e) => e.d.work!);
  const map = new Map<number, Mark[]>();
  for (const a of annotations) {
    const res = resolveAnchor(a.anchor, workBlocks);
    if (!res) continue;
    const entry = workEntries[res.blockIndex];
    if (!entry) continue;
    const marks = map.get(entry.dispIdx) ?? [];
    marks.push({
      start: res.start,
      end: res.end,
      role: a.id === focusedId ? "mark-focus" : a.kind === "suggestion" ? "mark-suggestion" : "mark-comment",
      annotationId: a.id,
    });
    map.set(entry.dispIdx, marks);
  }
  return map;
}

/** Base runs for a display block: plain text, or word-diff for mod blocks. */
export function blockRuns(d: DisplayBlock, markup: boolean): StyleRun[] {
  if (d.type === "mod" && markup) {
    const ops = wordDiff(d.base!.text, d.work!.text);
    const runs: StyleRun[] = [];
    let off = 0;
    for (const op of ops) {
      if (op.t === "del") {
        runs.push({ text: op.a!, role: "del", start: null });
      } else {
        runs.push({ text: op.b!, role: op.t === "add" ? "ins" : "plain", start: off });
        off += op.b!.length;
      }
    }
    return runs;
  }
  return [{ text: displayText(d), role: "plain", start: 0 }];
}

/** Split runs at mark boundaries; marks only bind to runs with offsets. */
export function overlayMarks(runs: StyleRun[], marks: Mark[]): StyleRun[] {
  if (!marks.length) return runs;
  const out: StyleRun[] = [];
  for (const run of runs) {
    if (run.start === null) {
      out.push(run);
      continue;
    }
    const bounds = new Set<number>([0, run.text.length]);
    for (const m of marks) {
      const s = Math.max(0, m.start - run.start);
      const e = Math.min(run.text.length, m.end - run.start);
      if (s < e) {
        bounds.add(s);
        bounds.add(e);
      }
    }
    const runStart = run.start;
    const pts = [...bounds].sort((a, b) => a - b);
    for (let i = 0; i < pts.length - 1; i++) {
      const s = pts[i]!;
      const e = pts[i + 1]!;
      if (s >= e) continue;
      const abs = runStart + s;
      const mark = marks.find((m) => m.start <= abs && runStart + e <= m.end);
      out.push({
        text: run.text.slice(s, e),
        // a mark never overrides ins/del emphasis; it rides on plain text
        role: mark && run.role === "plain" ? mark.role : run.role,
        start: abs,
        annotationId: mark?.annotationId ?? run.annotationId,
      });
    }
  }
  return out;
}

/**
 * Wrap styled runs into lines of at most `width` display cells. Split pieces
 * keep exact `start` offsets into the block text, so wrapped lines stay
 * addressable for the native selection primitive.
 */
export function wrapRuns(runs: StyleRun[], width: number): StyleRun[][] {
  const lines: StyleRun[][] = [];
  let line: StyleRun[] = [];
  let used = 0;
  const pushLine = () => {
    lines.push(line);
    line = [];
    used = 0;
  };
  for (const run of runs) {
    // split run into word/space tokens; newlines force breaks
    const tokens = run.text.split(/(\n|\s+)/).filter((t) => t !== "");
    let consumed = 0;
    const startAt = (offsetInRun: number): number | null => (run.start === null ? null : run.start + offsetInRun);
    for (const tok of tokens) {
      if (tok === "\n") {
        consumed += 1;
        pushLine();
        continue;
      }
      if (used + tok.length > width && used > 0 && tok.trim() !== "") pushLine();
      if (tok.trim() === "" && used === 0 && lines.length > 0) {
        consumed += tok.length;
        continue; // no leading spaces after wrap
      }
      let slice = tok;
      while (slice.length > width) {
        const piece = slice.slice(0, width - used);
        line.push({ ...run, text: piece, start: startAt(consumed) });
        consumed += piece.length;
        slice = slice.slice(piece.length);
        pushLine();
      }
      line.push({ ...run, text: slice, start: startAt(consumed) });
      consumed += slice.length;
      used += slice.length;
    }
  }
  if (line.length || !lines.length) lines.push(line);
  return lines;
}

/**
 * Locate a block-text offset inside wrapped run lines: the wrapped line index
 * and the column within the line's rendered run text. Drives the renderer's
 * native selection from keyboard span offsets.
 */
export function locateOffset(lines: StyleRun[][], offset: number): { lineIndex: number; column: number } | null {
  for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
    let column = 0;
    for (const run of lines[lineIndex]!) {
      if (run.start !== null && offset >= run.start && offset < run.start + run.text.length) {
        return { lineIndex, column: column + (offset - run.start) };
      }
      column += run.text.length;
    }
  }
  return null;
}

/**
 * Inline compose box height, shared by layout and render so the row math and
 * the mounted box never drift: top border (title), the single-row input, the
 * Save/Cancel button row, bottom border.
 */
export function composeBoxHeight(): number {
  return 4;
}

/** Line delta between two revision contents, for the sheet-header summary. */
export function revisionDelta(previousContent: string, nextContent: string): { added: number; removed: number } {
  const ops = lcsDiff(previousContent.split("\n"), nextContent.split("\n"), (a, b) => a === b);
  let added = 0;
  let removed = 0;
  for (const op of ops) {
    if (op.t === "add") added++;
    else if (op.t === "del") removed++;
  }
  return { added, removed };
}

// ── keyboard span mode ────────────────────────

export interface SpanState {
  dispIdx: number;
  wordIdx: number;
  wordEnd: number;
  start: number;
  end: number;
}

export function wordRanges(text: string): [number, number][] {
  const out: [number, number][] = [];
  const re = /\S+/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) out.push([m.index, m.index + m[0]!.length]);
  return out;
}

export function startSpan(dispIdx: number, text: string): SpanState | null {
  const words = wordRanges(text);
  if (!words.length) return null;
  return { dispIdx, wordIdx: 0, wordEnd: 0, start: words[0]![0], end: words[0]![1] };
}

export function spanKey(span: SpanState, key: string, text: string): SpanState {
  const words = wordRanges(text);
  const s = { ...span };
  const width = s.wordEnd - s.wordIdx;
  if (key === "l") s.wordEnd = Math.min(words.length - 1, s.wordEnd + 1);
  else if (key === "h") s.wordEnd = Math.max(s.wordIdx, s.wordEnd - 1);
  else if (key === "w") {
    const n = Math.min(words.length - 1 - width, s.wordIdx + 1);
    s.wordIdx = n;
    s.wordEnd = n + width;
  } else if (key === "b") {
    const n = Math.max(0, s.wordIdx - 1);
    s.wordIdx = n;
    s.wordEnd = n + width;
  } else if (key === "$") s.wordEnd = words.length - 1;
  else if (key === "0") {
    s.wordEnd = width;
    s.wordIdx = 0;
  } else return span;
  s.start = words[s.wordIdx]![0];
  s.end = words[s.wordEnd]![1];
  return s;
}

// ── working-copy block operations ─────────────

/** The next work block after a display index (a del block re-enters before it). */
export function nextWorkBlock(display: DisplayBlock[], dispIdx: number): Block | undefined {
  for (let i = dispIdx + 1; i < display.length; i++) {
    const w = display[i]!.work;
    if (w) return w;
  }
  return undefined;
}
