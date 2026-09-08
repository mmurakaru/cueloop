/**
 * The session tree as rows for the rail's Tree tab. The trunk is the current
 * branch's path (falling back to main), drawn at depth 0; every other segment
 * indents under the entry it grew from. Rows know whether they sit on the
 * active path, which branch tips rest on them, and the checkpoint name they
 * carry, so the pane only paints. Pure: no controller, no daemon.
 */

import {
  MAIN_BRANCH,
  pathOf,
  tipOf,
  type SessionEntry,
  type SessionHistory,
} from "@cueloop/schema";

export interface TreeRow {
  entryId: string;
  /** Branch nesting: 0 is the trunk, each segment off it one deeper. */
  depth: number;
  /** One glyph naming the entry kind, for the left column. */
  glyph: string;
  /** What the entry is, in a few words. */
  text: string;
  /** On the current branch's path: painted bright; everything else dim. */
  onPath: boolean;
  /** Branches whose tip rests on this entry. */
  tips: string[];
  /** The current branch's tip: where the next entry lands. */
  isCurrentTip: boolean;
  /** The checkpoint name, when labelled. */
  label?: string;
}

/** What going to an entry means from where the reviewer stands. */
export type EntryTarget =
  | { kind: "here" }
  | { kind: "switch"; branch: string }
  | { kind: "navigate"; entryId: string; branch: string };

/** The one-glyph, few-words reading of an entry a row shows. */
export interface EntryDescription {
  glyph: string;
  text: string;
}

/** The entry's kind, said briefly; agent revisions count their round along the path. */
export function describeEntry(entry: SessionEntry, round?: number): EntryDescription {
  switch (entry.type) {
    case "revision":
      return entry.by === "agent"
        ? { glyph: "◉", text: round === undefined ? "revision" : `revision ${round}` }
        : { glyph: "○", text: "edit" };
    case "comment":
      return { glyph: "·", text: "comment" };
    case "comment-removed":
      return { glyph: "·", text: "comment removed" };
    case "verdict":
      return {
        glyph: entry.verdict.kind === "approve" ? "✓" : "✗",
        text: entry.verdict.kind.replace("_", " "),
      };
    case "branch-summary":
      return { glyph: "↩", text: entry.text ? `"${entry.text}"` : "returned" };
  }
}

/** Rows in drawing order: trunk first at each fork, older segments before newer. */
export function treeRows(history: SessionHistory): TreeRow[] {
  const children = new Map<string | null, SessionEntry[]>();

  for (const entry of history.entries) {
    const siblings = children.get(entry.parentId) ?? [];

    siblings.push(entry);
    children.set(entry.parentId, siblings);
  }
  for (const siblings of children.values()) {
    siblings.sort(
      (left, right) =>
        left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id),
    );
  }
  const onPath = new Set(pathOf(history).map((entry) => entry.id));
  const onMain = new Set(pathOf(history, tipOf(history, MAIN_BRANCH)).map((entry) => entry.id));
  const tipsByEntry = new Map<string, string[]>();

  for (const [branch, tip] of Object.entries(history.tips)) {
    tipsByEntry.set(tip, [...(tipsByEntry.get(tip) ?? []), branch]);
  }
  const currentTip = tipOf(history);
  const rows: TreeRow[] = [];
  // the trunk continues through the child on the active path, else on main, else the oldest
  const trunkChild = (siblings: SessionEntry[]): SessionEntry =>
    siblings.find((entry) => onPath.has(entry.id)) ??
    siblings.find((entry) => onMain.has(entry.id)) ??
    siblings[0]!;
  const walk = (entry: SessionEntry, depth: number, round: number): void => {
    const nextRound = entry.type === "revision" && entry.by === "agent" ? round + 1 : round;
    const described = describeEntry(
      entry,
      entry.type === "revision" && entry.by === "agent" ? nextRound : undefined,
    );
    const label = history.labels[entry.id];
    const row: TreeRow = {
      entryId: entry.id,
      depth,
      glyph: described.glyph,
      text: described.text,
      onPath: onPath.has(entry.id),
      tips: tipsByEntry.get(entry.id) ?? [],
      isCurrentTip: entry.id === currentTip,
    };

    if (label !== undefined) row.label = label;
    rows.push(row);
    const siblings = children.get(entry.id) ?? [];

    if (siblings.length === 0) return;
    const trunk = trunkChild(siblings);

    for (const child of siblings) if (child !== trunk) walk(child, depth + 1, nextRound);
    walk(trunk, depth, nextRound);
  };

  for (const root of children.get(null) ?? []) walk(root, 0, 0);

  return rows;
}

/**
 * Going to an entry: nothing when it is the current tip; a switch when it is
 * another branch's tip; otherwise a navigate on the branch whose path holds
 * it - the current branch when it can, else the first branch that reaches it.
 */
export function entryTarget(history: SessionHistory, entryId: string): EntryTarget | null {
  if (entryId === tipOf(history)) return { kind: "here" };
  const tipBranch = Object.entries(history.tips).find(([, tip]) => tip === entryId);

  if (tipBranch) return { kind: "switch", branch: tipBranch[0] };
  const holds = (branch: string): boolean =>
    pathOf(history, tipOf(history, branch)).some((entry) => entry.id === entryId);
  const branch = holds(history.branch)
    ? history.branch
    : Object.keys(history.tips).find((candidate) => holds(candidate));

  return branch === undefined ? null : { kind: "navigate", entryId, branch };
}
