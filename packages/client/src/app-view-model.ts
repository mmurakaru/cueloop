import type { Dispatch, MutableRefObject, SetStateAction } from "react";
import type { ReviewSession, VerdictKind } from "@cueloop/schema";
import { activeSpanState, reviewerAnnotations, type Mode } from "./intent-dispatch";
import { displayText, type DisplayBlock } from "./view-plan";
import type { DiffRow } from "./view-diff";
import type { Intent, KeyState } from "./keymap";
import type { Completion, ReviewController } from "./session-controller";
import type { QuickAction } from "./config";
import type { WalkFile } from "./walk";
import { viewedCount } from "./walk";
import type { PlanComposeState, PlanPopoverState } from "./components/PlanSheet";
import type { DiffComposeState } from "./components/DiffSheet";
import type { ConfirmCardProps } from "./components/ConfirmCard";
import type { RailCardEdit } from "./components/ReviewRail";
import type { BreadcrumbItem } from "./components/Breadcrumb";
import { REVIEW_COMPACT_WIDTH, resolveReviewWidth, type ReviewPanelMode } from "./review-panel";

export function computeRoleCapabilities(
  readOnly: boolean,
  role: "owner" | "observer" | "collaborator",
) {
  const observer = readOnly || role === "observer";

  return { observer, isOwner: !observer && role === "owner" };
}

export function deriveReviewFlags(session: ReviewSession | null) {
  return {
    isDiff: session?.artifact.type === "diff",
    isPrototype: session?.artifact.type === "prototype",
    resolved: session?.status === "resolved",
  };
}

export function isWalking(isDiff: boolean, walk: { index: number } | null): boolean {
  return isDiff && walk !== null;
}

export function resolveOverlay(
  mode: Mode,
  completionPhase: Completion["phase"],
  walking: boolean,
): KeyState["overlay"] {
  if (mode.type === "compose" || mode.type === "railEdit") return "compose";
  if (mode.type === "submit") return "submit";
  if (mode.type === "confirmDelete") return "confirm";
  if (mode.type === "rename" || mode.type === "nameSelf") return "prompt";
  if (mode.type === "spanActions") return "spanActions";
  if (completionPhase === "prompt") return "completion-prompt";
  if (completionPhase === "counting") return "completion-counting";
  if (walking) return "walk";

  return "none";
}

export function isCompletionOverlayPhase(
  completion: Completion,
): completion is { phase: "prompt" } | { phase: "counting"; remaining: number } {
  return completion.phase === "prompt" || completion.phase === "counting";
}

export function computePendingCount(session: ReviewSession): number {
  return reviewerAnnotations(session).length + (session.workingCopy !== undefined ? 1 : 0);
}

export function computeRailFootprint(
  reviewMode: ReviewPanelMode,
  reviewWidth: number,
  terminalWidth: number,
): number {
  if (reviewMode === "hidden") return 0;

  return (
    1 +
    (reviewMode === "compact"
      ? REVIEW_COMPACT_WIDTH
      : resolveReviewWidth(reviewWidth, terminalWidth))
  );
}

export function buildHeaderItems(params: {
  session: ReviewSession;
  resolved: boolean;
  observer: boolean;
  role: "owner" | "observer" | "collaborator";
}): BreadcrumbItem[] {
  const { session, resolved, observer, role } = params;

  return [
    { label: "cueloop", tone: "accent" },
    ...(resolved
      ? [
          {
            label: `resolved: ${session.verdict!.kind.replace("_", " ")}`,
            tone: "green" as const,
          },
        ]
      : []),
    ...(observer ? [{ label: "observer", tone: "dim" as const }] : []),
    ...(role === "collaborator"
      ? [{ label: "shared · your notes save as you go", tone: "dim" as const }]
      : []),
    {
      label: `${session.artifact.meta.title ?? session.artifact.meta.planPath ?? session.id} · rev ${session.revisions.length}`,
      tone: "dim",
    },
    { label: `submitted by ${session.artifact.meta.agent ?? "unknown"}`, tone: "dim" },
  ];
}

export function buildRenderFlags(params: {
  session: ReviewSession;
  isOwner: boolean;
  isDiff: boolean;
  isPrototype: boolean;
  resolved: boolean;
  menuOpen: boolean;
  menuDialog: "keybinds" | "settings" | null;
  resolvedIds: Set<string>;
}) {
  const { session, isOwner, isDiff, isPrototype, resolved, menuOpen, menuDialog, resolvedIds } =
    params;

  return {
    showOwnerActions: isOwner && !isDiff && !resolved,
    prototypeCanComment: isOwner && !resolved,
    chromeHidden: menuOpen || menuDialog !== null,
    prototypePath: session.artifact.meta.prototypePath ?? "",
    railResolvedIds: isDiff || isPrototype ? null : resolvedIds,
  };
}

export function buildActiveSpan(
  mode: Mode,
  isDiff: boolean,
): { displayIndex: number; start: number; end: number } | null {
  const markedSpan = activeSpanState(mode);

  if (markedSpan)
    return { displayIndex: markedSpan.displayIndex, start: markedSpan.start, end: markedSpan.end };
  if (mode.type === "compose" && !isDiff)
    return { displayIndex: mode.displayIndex, start: mode.start, end: mode.end };

  return null;
}

interface DraftHandlerDeps {
  liveInput: MutableRefObject<string>;
  setMode: Dispatch<SetStateAction<Mode>>;
  dispatch: (intent: Intent) => void;
}

export function buildComposeState(
  deps: DraftHandlerDeps & { mode: Mode; isDiff: boolean; display: DisplayBlock[] },
): PlanComposeState | null {
  const { mode, isDiff, display, liveInput, setMode, dispatch } = deps;

  if (mode.type !== "compose" || isDiff) return null;

  return {
    kind: mode.kind,
    displayIndex: mode.displayIndex,
    quote: displayText(display[mode.displayIndex]!).slice(mode.start, mode.end),
    draft: {
      text: mode.text,
      onInput: (text: string) => {
        liveInput.current = text;
        setMode({ ...mode, text });
      },
      onSave: () => dispatch({ type: "saveCompose" }),
      onCancel: () => dispatch({ type: "closeOverlay" }),
    },
  };
}

export function buildDiffComposeState(
  deps: DraftHandlerDeps & { mode: Mode; isDiff: boolean; rows: DiffRow[] },
): DiffComposeState | null {
  const { mode, isDiff, rows, liveInput, setMode, dispatch } = deps;

  if (mode.type !== "compose" || !isDiff) return null;

  return {
    kind: mode.kind,
    rowIndex: mode.displayIndex,
    quote: rows[mode.displayIndex]?.text.replace(/\n$/, "") ?? "",
    draft: {
      text: mode.text,
      onInput: (text: string) => {
        liveInput.current = text;
        setMode({ ...mode, text });
      },
      onSave: () => dispatch({ type: "saveCompose" }),
      onCancel: () => dispatch({ type: "closeOverlay" }),
    },
  };
}

export function buildPopoverState(deps: {
  mode: Mode;
  isDiff: boolean;
  quickActions: QuickAction[];
  isOwner: boolean;
  observer: boolean;
  resolved: boolean;
  controller: ReviewController;
  dispatch: (intent: Intent) => void;
}): PlanPopoverState | null {
  const { mode, isDiff, quickActions, isOwner, observer, resolved, controller, dispatch } = deps;
  const markedSpan = activeSpanState(mode);

  if (!markedSpan || isDiff) return null;
  const spanMutationBlock = (): string | null =>
    observer ? "observer - read-only" : resolved ? "review submitted - read-only" : null;

  return {
    displayIndex: markedSpan.displayIndex,
    view: mode.type === "spanActions" ? ("actions" as const) : ("toolbar" as const),
    actions: quickActions,
    actionIndex: mode.type === "spanActions" ? mode.index : 0,
    canCut: isOwner,
    onComment: () => {
      const blocked = spanMutationBlock();

      if (blocked) return controller.setStatus(blocked);
      dispatch({ type: "openCompose", kind: "comment", from: "span" });
    },
    onCut: () => {
      const blocked = spanMutationBlock();

      if (blocked) return controller.setStatus(blocked);
      if (!isOwner) return;
      dispatch({ type: "spanCut" });
    },
    onOpenActions: () => {
      const blocked = spanMutationBlock();

      if (blocked) return controller.setStatus(blocked);
      dispatch({ type: "openSpanActions" });
    },
    onClose: () => dispatch({ type: "closeOverlay" }),
    onPickAction: (index: number) => {
      const blocked = spanMutationBlock();

      if (blocked) return controller.setStatus(blocked);
      dispatch({ type: "pickSpanAction", index });
    },
    onBack: () => dispatch({ type: "closeSpanActions" }),
  };
}

export function buildSubmitConfirmState(
  deps: DraftHandlerDeps & {
    mode: Mode;
    isDiff: boolean;
    session: ReviewSession;
    walkFileList: WalkFile[];
    viewedPaths: Set<string>;
  },
): Omit<ConfirmCardProps, "theme"> | null {
  const { mode, isDiff, session, walkFileList, viewedPaths, liveInput, setMode, dispatch } = deps;

  if (mode.type !== "submit") return null;

  return {
    verdict: mode.verdict,
    summary: mode.summary,
    viewedSummary:
      isDiff && session.viewedPaths !== undefined
        ? `${viewedCount(walkFileList, viewedPaths)}/${walkFileList.length} files viewed`
        : undefined,
    onInput: (summary: string) => {
      liveInput.current = summary;
      setMode({ ...mode, summary });
    },
    onSelectVerdict: (verdict: VerdictKind) => setMode({ ...mode, verdict }),
    onSubmit: () => dispatch({ type: "submitVerdict" }),
    onCancel: () => dispatch({ type: "closeOverlay" }),
  };
}

export function buildCardEditState(deps: DraftHandlerDeps & { mode: Mode }): RailCardEdit | null {
  const { mode, liveInput, setMode, dispatch } = deps;

  if (mode.type !== "railEdit") return null;

  return {
    id: mode.id,
    text: mode.text,
    onInput: (text: string) => {
      liveInput.current = text;
      setMode({ type: "railEdit", id: mode.id, text });
    },
    onSave: () => dispatch({ type: "saveCompose" }),
    onCancel: () => dispatch({ type: "closeOverlay" }),
  };
}
