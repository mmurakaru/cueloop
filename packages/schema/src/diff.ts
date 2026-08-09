/**
 * Line/token diffing and unified-diff serialization. The working copy
 * serializes as ONE unified diff against the submitted revision.
 * Pure algorithms, no IO.
 */

export type DiffOpKind = "ctx" | "del" | "add";

export interface DiffOp<T = string> {
  kind: DiffOpKind;
  /** Present for ctx and del. */
  oldValue?: T;
  /** Present for ctx and add. */
  newValue?: T;
}

/** LCS diff over arrays. O(n*m) - fine for plan-sized documents. */
export function lcsDiff<T>(
  oldItems: T[],
  newItems: T[],
  equals: (oldItem: T, newItem: T) => boolean = (oldItem, newItem) => oldItem === newItem,
): DiffOp<T>[] {
  const oldCount = oldItems.length;
  const newCount = newItems.length;
  const longestCommon: number[][] = Array.from({ length: oldCount + 1 }, () => new Array<number>(newCount + 1).fill(0));
  for (let oldIndex = oldCount - 1; oldIndex >= 0; oldIndex--) {
    for (let newIndex = newCount - 1; newIndex >= 0; newIndex--) {
      longestCommon[oldIndex]![newIndex] = equals(oldItems[oldIndex]!, newItems[newIndex]!)
        ? longestCommon[oldIndex + 1]![newIndex + 1]! + 1
        : Math.max(longestCommon[oldIndex + 1]![newIndex]!, longestCommon[oldIndex]![newIndex + 1]!);
    }
  }
  const ops: DiffOp<T>[] = [];
  let oldIndex = 0;
  let newIndex = 0;
  while (oldIndex < oldCount && newIndex < newCount) {
    if (equals(oldItems[oldIndex]!, newItems[newIndex]!)) {
      ops.push({ kind: "ctx", oldValue: oldItems[oldIndex], newValue: newItems[newIndex] });
      oldIndex++;
      newIndex++;
    } else if (longestCommon[oldIndex + 1]![newIndex]! >= longestCommon[oldIndex]![newIndex + 1]!) {
      ops.push({ kind: "del", oldValue: oldItems[oldIndex] });
      oldIndex++;
    } else {
      ops.push({ kind: "add", newValue: newItems[newIndex] });
      newIndex++;
    }
  }
  while (oldIndex < oldCount) ops.push({ kind: "del", oldValue: oldItems[oldIndex++] });
  while (newIndex < newCount) ops.push({ kind: "add", newValue: newItems[newIndex++] });
  return ops;
}

export interface UnifiedLine {
  kind: DiffOpKind | "hunk";
  text: string;
}

/**
 * Unified diff with hunk headers. Returns null when the inputs are equal -
 * "no diff" is a distinct state from "empty diff".
 */
export function unifiedDiff(oldText: string, newText: string, context = 3): UnifiedLine[] | null {
  const ops = lcsDiff(oldText.split("\n"), newText.split("\n"));
  if (!ops.some((op) => op.kind !== "ctx")) return null;
  let oldLineNumber = 1;
  let newLineNumber = 1;
  const rows = ops.map((op) => {
    const row = {
      kind: op.kind,
      text: (op.kind === "add" ? op.newValue : op.oldValue) ?? "",
      oldLine: op.kind !== "add" ? oldLineNumber : null,
      newLine: op.kind !== "del" ? newLineNumber : null,
    };
    if (op.kind !== "add") oldLineNumber++;
    if (op.kind !== "del") newLineNumber++;
    return row;
  });
  const keep = new Array<boolean>(rows.length).fill(false);
  rows.forEach((row, rowIndex) => {
    if (row.kind !== "ctx") {
      for (
        let keepIndex = Math.max(0, rowIndex - context);
        keepIndex <= Math.min(rows.length - 1, rowIndex + context);
        keepIndex++
      ) {
        keep[keepIndex] = true;
      }
    }
  });
  const hunks: { rows: (typeof rows)[number][] }[] = [];
  let openHunk: { rows: (typeof rows)[number][] } | null = null;
  rows.forEach((row, rowIndex) => {
    if (!keep[rowIndex]) {
      openHunk = null;
      return;
    }
    if (!openHunk) {
      openHunk = { rows: [] };
      hunks.push(openHunk);
    }
    openHunk.rows.push(row);
  });
  const lines: UnifiedLine[] = [];
  for (const hunk of hunks) {
    const oldStart = hunk.rows.find((row) => row.oldLine !== null)?.oldLine ?? 1;
    const newStart = hunk.rows.find((row) => row.newLine !== null)?.newLine ?? 1;
    const oldCount = hunk.rows.filter((row) => row.kind !== "add").length;
    const newCount = hunk.rows.filter((row) => row.kind !== "del").length;
    lines.push({ kind: "hunk", text: `@@ -${oldStart},${oldCount} +${newStart},${newCount} @@` });
    for (const row of hunk.rows) {
      lines.push({ kind: row.kind, text: (row.kind === "add" ? "+" : row.kind === "del" ? "-" : " ") + row.text });
    }
  }
  return lines;
}

/** Render a unified diff as text with file headers. */
export function unifiedDiffText(oldText: string, newText: string, path = "plan.md", context = 3): string | null {
  const lines = unifiedDiff(oldText, newText, context);
  if (!lines) return null;
  return [`--- a/${path}`, `+++ b/${path}`, ...lines.map((line) => line.text)].join("\n");
}

export interface EditStats {
  added: number;
  removed: number;
}

export function editStats(oldText: string, newText: string): EditStats {
  const lines = unifiedDiff(oldText, newText, 0);
  if (!lines) return { added: 0, removed: 0 };
  return {
    added: lines.filter((line) => line.kind === "add").length,
    removed: lines.filter((line) => line.kind === "del").length,
  };
}

/** Word-level diff ops for tracked-changes rendering. Whitespace-preserving. */
export function wordDiff(oldText: string, newText: string): DiffOp[] {
  const tokenize = (text: string) => text.split(/(\s+)/).filter((token) => token !== "");
  return lcsDiff(tokenize(oldText), tokenize(newText));
}
