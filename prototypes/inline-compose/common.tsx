/**
 * Shared harness for the inline-compose prototypes (#71): sample plan
 * content, theme, doc-line rendering, and item windowing with per-item
 * heights so a multi-row compose box scrolls like any other row.
 */

import React from "react";
import { DARK as T } from "../../packages/client/src/theme";

export { T };

export interface PlanLine {
  text: string;
  kind: "h1" | "h2" | "p" | "li" | "code" | "blank";
}

const src: [PlanLine["kind"], string][] = [
  ["h1", "Implementation Plan: Session Persistence"],
  ["blank", ""],
  ["h2", "Context"],
  ["p", "Review sessions currently live only in daemon memory. If the daemon"],
  ["p", "crashes or restarts mid-review, every pending annotation and the"],
  ["p", "draft verdict are lost, and the submitting agent waits on a session"],
  ["p", "that no longer exists. This plan persists each session to disk."],
  ["blank", ""],
  ["h2", "Phase 1: Storage layer"],
  ["li", "- one JSON document per session under the daemon state directory"],
  ["li", "- every write goes through a temp file and an atomic rename"],
  ["li", "- recovery is a read-only scan; bad records are skipped, not deleted"],
  ["blank", ""],
  ["code", "interface SessionRecord {"],
  ["code", "  schemaVersion: string;"],
  ["code", "  id: string;"],
  ["code", "  annotations: Annotation[];"],
  ["code", "  verdict: Verdict | null;"],
  ["code", "}"],
  ["blank", ""],
  ["h2", "Phase 2: Recovery"],
  ["p", "On boot the daemon scans the sessions directory and rebuilds its"],
  ["p", "in-memory index. Waiters reattach through session.wait, which"],
  ["p", "resolves immediately when the verdict already landed."],
  ["blank", ""],
  ["li", "- recover() returns a report: recovered ids and skipped files"],
  ["li", "- a corrupt record never blocks the rest of the scan"],
  ["li", "- idle-exit only counts sessions that are still pending"],
  ["blank", ""],
  ["h2", "Phase 3: Retention"],
  ["p", "Resolved sessions older than the retention window are pruned on"],
  ["p", "boot. The window is configurable; the default keeps ninety days."],
  ["blank", ""],
  ["li", "- prune runs after recovery, never during a review"],
  ["li", "- pruning a session emits no events; it is invisible to clients"],
  ["blank", ""],
  ["h2", "Testing"],
  ["p", "Crash the daemon mid-write in a temp home, restart, and assert the"],
  ["p", "session survives byte-for-byte. Fuzz the recovery scan with"],
  ["p", "truncated JSON, wrong shapes, and foreign files in the directory."],
];

export const PLAN: PlanLine[] = src.map(([kind, text]) => ({ kind, text }));

export function lineFg(kind: PlanLine["kind"]): string {
  switch (kind) {
    case "h1":
      return T.accent;
    case "h2":
      return T.blue;
    case "code":
      return T.green;
    case "li":
      return T.text;
    default:
      return T.textMuted;
  }
}

/** One visible thing in the document flow, with its row height. */
export interface Item {
  key: string;
  height: number;
  node: React.ReactNode;
  /** Doc line this item belongs to, for reveal math. */
  line: number;
}

/** First item index so that items[target] fits fully inside viewH rows. */
export function revealScroll(items: Item[], scroll: number, target: number, viewH: number): number {
  if (target < scroll) return target;
  let used = 0;
  for (let i = scroll; i <= target; i++) used += items[i]!.height;
  let s = scroll;
  while (used > viewH && s < target) {
    used -= items[s]!.height;
    s++;
  }
  return s;
}

/** Slice items to what fits in viewH rows starting at scroll. */
export function visible(items: Item[], scroll: number, viewH: number): Item[] {
  const out: Item[] = [];
  let used = 0;
  for (let i = scroll; i < items.length && used < viewH; i++) {
    out.push(items[i]!);
    used += items[i]!.height;
  }
  return out;
}
