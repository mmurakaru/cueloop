/**
 * The right review rail: tab strip (Review/Agent), the scrollable annotation
 * stack, and the pinned submit affordance. The confirm card sits OUTSIDE the
 * scrollbox so the stack scrolls while the card stays at the rail bottom.
 * Card reveal goes through the scrollbox's own scrollChildIntoView - no
 * hardcoded card-height arithmetic.
 */

import React, { forwardRef, useImperativeHandle, useRef } from "react";
import type { ScrollBoxRenderable } from "@opentui/core";
import { isAddressed, isAgentNote, type Annotation, type ReviewSession } from "@cueloop/schema";
import type { Theme } from "../theme";
import { useComponentTheme } from "./theme-context";
import { Tabs, Tab, TabList } from "./primitives/Tabs";
import { Button } from "./primitives/Button";
import { AnnotationCard, type AnnotationDraft } from "./AnnotationCard";
import { ConfirmCard, type ConfirmCardProps } from "./ConfirmCard";
import { resolveDisplayName } from "../attribution";

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
  /** Planner-local author renames (config [authors]); override the registry name. */
  authorNames: Record<string, string>;
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
    authorNames,
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
  const collaboratorsPresent = session.annotations.some((annotation) => annotation.author);

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
    <box style={{ width, backgroundColor: tokens.panel, flexDirection: "column", paddingLeft: 1, paddingBottom: 1 }}>
      <Tabs selectedKey={railTab} onSelectionChange={(key) => onTabChange(key as RailTab)} theme={theme}>
        <TabList>
          <Tab id="review">Review</Tab>
          <Tab id="agent">Agent</Tab>
        </TabList>
      </Tabs>
      {railTab === "agent" ? (
        <box style={{ flexGrow: 1, flexDirection: "column", paddingLeft: 2 }}>
          <text> </text>
          <AgentTab session={session} theme={theme} />
        </box>
      ) : openAnnotations.length === 0 ? (
        <box style={{ flexGrow: 1, alignItems: "center", justifyContent: "center" }}>
          <text fg={tokens.textDim}>{session.annotations.length === 0 ? "no annotations yet" : "all annotations addressed"}</text>
        </box>
      ) : (
        <box style={{ flexGrow: 1, flexDirection: "column", paddingLeft: 2 }}>
          <text> </text>
          {session.workingCopy !== undefined ? <text fg={tokens.textDim}>± plan edits → one diff</text> : null}
          {addressedCount > 0 ? <text fg={tokens.textDim}>✓ {addressedCount} addressed by revision</text> : null}
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
                  authorLabel: annotation.author ? resolveDisplayName(annotation.author, session.participants, authorNames) : undefined,
                  selfLabel: !annotation.author && !isAgentNote(annotation) && collaboratorsPresent ? "me" : undefined,
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
        </box>
      )}
      {/* the confirm card keeps full width, above the footer row */}
      {railTab !== "agent" && submitConfirm ? <ConfirmCard {...submitConfirm} theme={theme} /> : null}
      {/* footer row: collapse chevron left-bound, the submit affordance inline
          beside it, both on the rail's last row (the plan's bottom-border height) */}
      <box style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
        {onCollapse ? (
          <box onMouseUp={onCollapse}>
            <text fg={tokens.textDim}>»</text>
          </box>
        ) : null}
        {railTab !== "agent" && !submitConfirm ? (
          session.status === "resolved" ? (
            <text fg={tokens.green}>resolved: {session.verdict!.kind.replace("_", " ")}</text>
          ) : (
            <Button variant="accent-text" onPress={onSubmitRequest} theme={theme}>
              Submit review
            </Button>
          )
        ) : null}
      </box>
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
