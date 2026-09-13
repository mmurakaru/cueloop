import type { Dispatch, MutableRefObject, SetStateAction } from "react";
import type { Thread, VerdictKind } from "@cueloop/schema";
import type { Mode } from "./intent-dispatch";
import type { Intent, KeyState } from "./keymap";
import type { Completion } from "./thread-controller";
import type { WalkFile } from "./walk";
import { viewedCount } from "./walk";
import type { ConfirmCardProps } from "./components/ConfirmCard";
import type { BreadcrumbItem } from "./components/Breadcrumb";

export function computeRoleCapabilities(
  readOnly: boolean,
  role: "owner" | "observer" | "collaborator",
) {
  const observer = readOnly || role === "observer";

  return { observer, isOwner: !observer && role === "owner" };
}

export function deriveReviewFlags(session: Thread | null) {
  return {
    isDiff: session?.artifact.type === "diff",
    isPrototype: session?.artifact.type === "prototype",
    resolved: session?.status === "resolved",
  };
}

export function isWalking(isDiff: boolean, walk: { index: number } | null): boolean {
  return isDiff && walk !== null;
}

/**
 * A prototype renders as a kitty pixel mockup only in the opt-in experimental mode:
 * the flag is on and the artifact carries an HTML entry. Otherwise it is the default
 * markdown design doc, rendered through the thread/markdown path.
 */
export function isPixelPrototypeMode(
  isPrototype: boolean,
  prototypePixels: boolean,
  prototypePath: string | undefined,
): boolean {
  return isPrototype && prototypePixels && Boolean(prototypePath);
}

export function resolveOverlay(
  mode: Mode,
  completionPhase: Completion["phase"],
  walking: boolean,
): KeyState["overlay"] {
  if (mode.type === "compose" || mode.type === "railEdit") return "compose";
  if (mode.type === "submit") return "submit";
  if (mode.type === "confirmDelete") return "confirm";
  if (
    mode.type === "rename" ||
    mode.type === "renameThread" ||
    mode.type === "nameSelf" ||
    mode.type === "treePrompt"
  )
    return "prompt";
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

export function buildHeaderItems(params: {
  session: Thread;
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
  session: Thread;
  isOwner: boolean;
  isDiff: boolean;
  isPixelPrototype: boolean;
  resolved: boolean;
  menuDialog: "keybinds" | "settings" | null;
  resolvedIds: Set<string>;
}) {
  const { session, isOwner, isDiff, isPixelPrototype, resolved, menuDialog, resolvedIds } = params;

  return {
    showOwnerActions: isOwner && !isDiff && !resolved,
    prototypeCanComment: isOwner && !resolved,
    chromeHidden: menuDialog !== null,
    prototypePath: session.artifact.meta.prototypePath ?? "",
    // a markdown prototype interleaves resolved cards like a plan; only the pixel mockup opts out
    railResolvedIds: isDiff || isPixelPrototype ? null : resolvedIds,
  };
}

interface DraftHandlerDeps {
  liveInput: MutableRefObject<string>;
  setMode: Dispatch<SetStateAction<Mode>>;
  dispatch: (intent: Intent) => void;
}

export function buildSubmitConfirmState(
  deps: DraftHandlerDeps & {
    mode: Mode;
    isDiff: boolean;
    session: Thread;
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
