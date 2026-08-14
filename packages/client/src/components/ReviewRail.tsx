/**
 * The right review rail: tab strip (Review/Agent), the scrollable annotation
 * stack, and the pinned submit affordance. The confirm card sits OUTSIDE the
 * scrollbox so the stack scrolls while the card stays at the rail bottom.
 * Card reveal goes through the scrollbox's own scrollChildIntoView - no
 * hardcoded card-height arithmetic.
 */

import React, { forwardRef, useImperativeHandle, useRef } from "react";
import type { ScrollBoxRenderable } from "@opentui/core";
import { isAddressed, type Annotation, type ReviewSession } from "@cueloop/schema";
import type { Theme } from "../theme";
import { useComponentTheme } from "./theme-context";
import { Tabs, Tab, TabList } from "./primitives/Tabs";
import { Button } from "./primitives/Button";
import { AnnotationCard, type AnnotationDraft } from "./AnnotationCard";
import { ConfirmCard, type ConfirmCardProps } from "./ConfirmCard";

export type RailTab = "review" | "agent";

export interface RailCardEdit extends AnnotationDraft {
  id: string;
}

export interface ReviewRailHandle {
  /** Scroll the card for an annotation into view (selection symmetry). */
  revealCard(annotationId: string): void;
}

export interface ReviewRailProps {
  session: ReviewSession;
  selectedId?: string;
  /** Ids whose anchor resolved; null = orphan display off (diff view). */
  resolvedIds: Set<string> | null;
  railTab: RailTab;
  pendingCount: number;
  cardEdit: RailCardEdit | null;
  submitConfirm: Omit<ConfirmCardProps, "theme"> | null;
  onTabChange: (tab: RailTab) => void;
  onSelectCard: (id: string) => void;
  onActivateCard: (id: string) => void;
  onSubmitRequest: () => void;
  /** Publish the plan as a share; omitted for non-owners (hides the button). */
  onShareRequest?: () => void;
  /** Rail column width; the app derives it from the persisted review layout. */
  width?: number;
  /**
   * When set, renders the muted `»` chevron pinned at the rail's bottom-left,
   * one column from the divider. Clicking it collapses the panel to compact.
   */
  onCollapse?: () => void;
  theme?: Theme;
}

/** Forward-compatible: open annotation kinds may carry a blocking flag. */
export function annotationBlocking(annotation: Annotation): boolean {
  return (annotation as Annotation & { blocking?: boolean }).blocking === true;
}

export const ReviewRail = forwardRef<ReviewRailHandle, ReviewRailProps>(function ReviewRail(
  {
    session,
    selectedId,
    resolvedIds,
    railTab,
    pendingCount,
    cardEdit,
    submitConfirm,
    onTabChange,
    onSelectCard,
    onActivateCard,
    onSubmitRequest,
    onShareRequest,
    width = 34,
    onCollapse,
    theme,
  }: ReviewRailProps,
  handleRef,
): React.ReactNode {
  const tokens = useComponentTheme(theme);
  const scrollRef = useRef<ScrollBoxRenderable | null>(null);
  // addressed annotations leave the card list; a dim count keeps them honest
  const openAnnotations = session.annotations.filter((annotation) => !isAddressed(annotation));
  const addressedCount = session.annotations.length - openAnnotations.length;

  useImperativeHandle(handleRef, () => ({
    revealCard: (annotationId: string): void => {
      try {
        scrollRef.current?.scrollChildIntoView(`annotation-card-${annotationId}`);
      } catch {
        // reveal is best-effort; selection state is already correct
      }
    },
  }));

  return (
    <box style={{ width, backgroundColor: tokens.panel, flexDirection: "column", paddingLeft: 1, paddingTop: 1 }}>
      <Tabs selectedKey={railTab} onSelectionChange={(key) => onTabChange(key as RailTab)} theme={theme}>
        <TabList>
          <Tab id="review">{`Review (${pendingCount})`}</Tab>
          <Tab id="agent">Agent</Tab>
        </TabList>
      </Tabs>
      <text> </text>
      {railTab === "agent" ? (
        <AgentTab session={session} theme={theme} />
      ) : (
        <>
          {session.workingCopy !== undefined ? <text fg={tokens.textDim}>± plan edits → one diff</text> : null}
          {addressedCount > 0 ? <text fg={tokens.textDim}>✓ {addressedCount} addressed by revision</text> : null}
          {openAnnotations.length === 0 ? (
            <text fg={tokens.textDim}>{session.annotations.length === 0 ? "no annotations yet" : "all annotations addressed"}</text>
          ) : (
            <scrollbox ref={scrollRef} style={{ flexGrow: 1 }} focused={false}>
              {openAnnotations.map((annotation) => (
                <AnnotationCard
                  key={annotation.id}
                  id={`annotation-card-${annotation.id}`}
                  kind={annotation.kind}
                  quote={annotation.anchor.quote}
                  theme={theme}
                  saved={{
                    body: annotation.body,
                    isSelected: annotation.id === selectedId,
                    isOrphan: resolvedIds !== null && !resolvedIds.has(annotation.id),
                    isBlocking: annotationBlocking(annotation),
                    editing:
                      cardEdit && cardEdit.id === annotation.id
                        ? {
                            text: cardEdit.text,
                            onInput: cardEdit.onInput,
                            onSave: cardEdit.onSave,
                            onCancel: cardEdit.onCancel,
                          }
                        : null,
                    onPress: () =>
                      annotation.id === selectedId ? onActivateCard(annotation.id) : onSelectCard(annotation.id),
                  }}
                />
              ))}
            </scrollbox>
          )}
          <box style={{ flexGrow: 1 }} />
          {/* the confirm card sits OUTSIDE the scrollbox: the annotation stack
              above scrolls while the card stays pinned to the rail bottom */}
          {session.status === "resolved" ? (
            <text fg={tokens.green}>resolved: {session.verdict!.kind.replace("_", " ")}</text>
          ) : submitConfirm ? (
            <ConfirmCard {...submitConfirm} theme={theme} />
          ) : (
            <Button variant="accent-text" onPress={onSubmitRequest} theme={theme}>
              {`Submit review (${pendingCount}) ⏎`}
            </Button>
          )}
          {onShareRequest && session.status !== "resolved" ? (
            <Button variant="plain" onPress={onShareRequest} theme={theme}>
              {"Share plan ⇧S"}
            </Button>
          ) : null}
        </>
      )}
      {/* the collapse chevron: muted, left-bound, one column from the divider.
          » points right - it hands the width back toward the plan */}
      {onCollapse ? (
        <box style={{ flexDirection: "row" }} onMouseUp={onCollapse}>
          <text fg={tokens.textDim}>»</text>
        </box>
      ) : null}
    </box>
  );
});

/** Agent tab: who submitted, where the session stands, which revision. */
function AgentTab({ session, theme }: { session: ReviewSession; theme?: Theme }): React.ReactNode {
  const tokens = useComponentTheme(theme);
  return (
    <box style={{ flexDirection: "column", flexGrow: 1 }}>
      <text fg={tokens.textMuted}>{session.artifact.meta.agent ?? "unknown"}</text>
      <text fg={tokens.textDim}>status: {session.status}</text>
      <text fg={tokens.textDim}>revision {session.revisions.length}</text>
    </box>
  );
}
