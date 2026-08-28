import type { ReviewSession } from "@cueloop/schema";
import type { Mode } from "./intent-dispatch";
import type { KeyState } from "./keymap";
import type { DisplayBlock } from "./view-plan";
import type { DiffRow } from "./view-diff";
import type { WalkFile } from "./walk";

export function buildKeyState(params: {
  keys: Record<string, string[]>;
  observer: boolean;
  isOwner: boolean;
  overlay: KeyState["overlay"];
  session: ReviewSession | null;
  isDiff: boolean;
  mode: Mode;
  resolved: boolean;
  inbox: ReviewSession[] | null;
  focusedAnnotationId: string | undefined;
  walk: { index: number } | null;
  walkFileList: WalkFile[];
  rows: DiffRow[];
  cursor: number;
  display: DisplayBlock[];
}): KeyState {
  const {
    keys,
    observer,
    isOwner,
    overlay,
    session,
    isDiff,
    mode,
    resolved,
    inbox,
    focusedAnnotationId,
    walk,
    walkFileList,
    rows,
    cursor,
    display,
  } = params;

  return {
    keys,
    readOnly: observer,
    canEditPlan: isOwner,
    canSubmitVerdict: isOwner,
    canShare: isOwner,
    overlay,
    view: !session ? "inbox" : isDiff ? "diff" : "plan",
    spanMode: mode.type === "span",
    resolved,
    hasInboxItems: !!inbox?.length,
    annotationCount: session?.annotations.length ?? 0,
    hasFocusedAnnotation: focusedAnnotationId !== undefined,
    walkAtEnd: walk !== null && walk.index >= walkFileList.length,
    cursorAnnotatable: isDiff
      ? rows[cursor] !== undefined && rows[cursor]!.kind !== "file" && rows[cursor]!.kind !== "hunk"
      : !!display[cursor]?.work,
  };
}
