/**
 * Line/token diffing and unified-diff serialization. The working copy
 * serializes as ONE unified diff against the submitted revision (map #2).
 * Pure algorithms, no IO.
 */

export type DiffOpType = "ctx" | "del" | "add";

export interface DiffOp<T = string> {
  t: DiffOpType;
  /** Present for ctx and del. */
  a?: T;
  /** Present for ctx and add. */
  b?: T;
}

/** LCS diff over arrays. O(n*m) - fine for plan-sized documents. */
export function lcsDiff<T>(a: T[], b: T[], eq: (x: T, y: T) => boolean = (x, y) => x === y): DiffOp<T>[] {
  const n = a.length;
  const m = b.length;
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i]![j] = eq(a[i]!, b[j]!) ? dp[i + 1]![j + 1]! + 1 : Math.max(dp[i + 1]![j]!, dp[i]![j + 1]!);
    }
  }
  const out: DiffOp<T>[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (eq(a[i]!, b[j]!)) {
      out.push({ t: "ctx", a: a[i], b: b[j] });
      i++;
      j++;
    } else if (dp[i + 1]![j]! >= dp[i]![j + 1]!) {
      out.push({ t: "del", a: a[i] });
      i++;
    } else {
      out.push({ t: "add", b: b[j] });
      j++;
    }
  }
  while (i < n) out.push({ t: "del", a: a[i++] });
  while (j < m) out.push({ t: "add", b: b[j++] });
  return out;
}

export interface UnifiedLine {
  t: DiffOpType | "hunk";
  text: string;
}

/**
 * Unified diff with hunk headers. Returns null when the inputs are equal -
 * "no diff" is a distinct state from "empty diff".
 */
export function unifiedDiff(oldText: string, newText: string, context = 3): UnifiedLine[] | null {
  const ops = lcsDiff(oldText.split("\n"), newText.split("\n"));
  if (!ops.some((o) => o.t !== "ctx")) return null;
  let ol = 1;
  let nl = 1;
  const rows = ops.map((o) => {
    const r = {
      t: o.t,
      text: (o.t === "add" ? o.b : o.a) ?? "",
      ol: o.t !== "add" ? ol : null,
      nl: o.t !== "del" ? nl : null,
    };
    if (o.t !== "add") ol++;
    if (o.t !== "del") nl++;
    return r;
  });
  const keep = new Array<boolean>(rows.length).fill(false);
  rows.forEach((r, idx) => {
    if (r.t !== "ctx") {
      for (let k = Math.max(0, idx - context); k <= Math.min(rows.length - 1, idx + context); k++) keep[k] = true;
    }
  });
  const hunks: { rows: (typeof rows)[number][] }[] = [];
  let cur: { rows: (typeof rows)[number][] } | null = null;
  rows.forEach((r, idx) => {
    if (!keep[idx]) {
      cur = null;
      return;
    }
    if (!cur) {
      cur = { rows: [] };
      hunks.push(cur);
    }
    cur.rows.push(r);
  });
  const out: UnifiedLine[] = [];
  for (const h of hunks) {
    const oStart = h.rows.find((r) => r.ol !== null)?.ol ?? 1;
    const nStart = h.rows.find((r) => r.nl !== null)?.nl ?? 1;
    const oCount = h.rows.filter((r) => r.t !== "add").length;
    const nCount = h.rows.filter((r) => r.t !== "del").length;
    out.push({ t: "hunk", text: `@@ -${oStart},${oCount} +${nStart},${nCount} @@` });
    for (const r of h.rows) {
      out.push({ t: r.t, text: (r.t === "add" ? "+" : r.t === "del" ? "-" : " ") + r.text });
    }
  }
  return out;
}

/** Render a unified diff as text with file headers. */
export function unifiedDiffText(oldText: string, newText: string, path = "plan.md", context = 3): string | null {
  const d = unifiedDiff(oldText, newText, context);
  if (!d) return null;
  return [`--- a/${path}`, `+++ b/${path}`, ...d.map((l) => l.text)].join("\n");
}

export interface EditStats {
  added: number;
  removed: number;
}

export function editStats(oldText: string, newText: string): EditStats {
  const d = unifiedDiff(oldText, newText, 0);
  if (!d) return { added: 0, removed: 0 };
  return {
    added: d.filter((r) => r.t === "add").length,
    removed: d.filter((r) => r.t === "del").length,
  };
}

/** Word-level diff ops for tracked-changes rendering. Whitespace-preserving. */
export function wordDiff(oldText: string, newText: string): DiffOp[] {
  const tok = (s: string) => s.split(/(\s+)/).filter((x) => x !== "");
  return lcsDiff(tok(oldText), tok(newText));
}
