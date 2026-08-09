/**
 * The projection pipeline (#22): parse → display blocks (base vs working
 * copy reconciled) → styled runs. Pure functions - the TUI renders the runs
 * (the native text primitive wraps them), tests assert on them directly.
 * One planning layer: rendering, navigation, and selection all derive from
 * this module; the rendered/work offset mappings keep the native selection
 * addressable over word-diffed blocks.
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
 * Rendered-text offset of a work-text offset within a block's runs. The
 * rendered text is every run's text in order (inline del runs included);
 * only positioned runs carry work offsets. Drives the renderer's native
 * selection from keyboard span offsets - the quote-anchor path depends on
 * this mapping staying exact.
 */
export function renderedOffsetFor(runs: StyleRun[], workOffset: number): number | null {
  let rendered = 0;
  for (const run of runs) {
    if (run.start !== null && workOffset >= run.start && workOffset < run.start + run.text.length) {
      return rendered + (workOffset - run.start);
    }
    rendered += run.text.length;
  }
  return null;
}

/**
 * Work-text range covered by a rendered-text selection [start, end). Del runs
 * and other unpositioned text inside the selection contribute nothing; the
 * result is the tightest work range whose text the selection touched.
 */
export function workRangeForRendered(
  runs: StyleRun[],
  renderedStart: number,
  renderedEnd: number,
): { start: number; end: number } | null {
  let rendered = 0;
  let range: { start: number; end: number } | null = null;
  for (const run of runs) {
    const runRenderedStart = rendered;
    const runRenderedEnd = rendered + run.text.length;
    rendered = runRenderedEnd;
    if (run.start === null) continue;
    const overlapStart = Math.max(renderedStart, runRenderedStart);
    const overlapEnd = Math.min(renderedEnd, runRenderedEnd);
    if (overlapEnd <= overlapStart) continue;
    const workStart = run.start + (overlapStart - runRenderedStart);
    const workEnd = run.start + (overlapEnd - runRenderedStart);
    if (!range) range = { start: workStart, end: workEnd };
    else {
      range.start = Math.min(range.start, workStart);
      range.end = Math.max(range.end, workEnd);
    }
  }
  return range;
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
