/**
 * The right review rail: tab strip (Review/Agent), the scrollable annotation
 * stack, and the pinned submit affordance. The confirm card sits OUTSIDE the
 * scrollbox so the stack scrolls while the card stays at the rail bottom.
 * Card reveal goes through the scrollbox's own scrollChildIntoView - no
 * hardcoded card-height arithmetic.
 */

import React, { forwardRef, useImperativeHandle, useRef } from "react";
import { createTextAttributes, type ScrollBoxRenderable } from "@opentui/core";
import { isAddressed, isAgentNote, type Annotation, type ReviewSession } from "@cueloop/schema";
import type { CurationItem } from "../session-controller";
import type { Theme } from "../theme";
import { useComponentTheme } from "./theme-context";
import { Tabs, Tab, TabList } from "./primitives/Tabs";
import { Button } from "./primitives/Button";
import { Toolbar } from "./primitives/Toolbar";
import { AnnotationCard, type AnnotationDraft } from "./AnnotationCard";
import { ConfirmCard, type ConfirmCardProps } from "./ConfirmCard";
import { AgentLauncher, type AgentTerminalHandle } from "./agent-launcher";
import { Card } from "./primitives/Card";
import { truncateToSingleLine } from "./truncate-text";
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
  /** Removed pieces (diff rejections / plan cuts) interleaved into the card stack. */
  curationItems: CurationItem[];
  /** The selected curation item, highlighted and the undo target. */
  selectedCurationId?: string;
  /**
   * Sort position per annotation id (diff row index / plan display index), so
   * annotation and removal cards interleave in one position-ordered stack.
   */
  annotationPositions?: Map<string, number>;
  railTab: RailTab;
  pendingCount: number;
  cardEdit: RailCardEdit | null;
  submitConfirm: Omit<ConfirmCardProps, "theme"> | null;
  onTabChange: (tab: RailTab) => void;
  onSelectCard: (id: string) => void;
  onActivateCard: (id: string) => void;
  /** Select a curation item (reveals its diff row); pressing undo restores it. */
  onSelectCuration: (id: string) => void;
  /** Restore a curation item (the selected card's undo button, same as the u key). */
  onUndoCuration: (id: string) => void;
  onSubmitRequest: () => void;
  /** Launch a bring-your-own harness in the rail (Agent tab); seedText is the plan-context briefing. */
  onLaunchHarness: (command: string, seedText?: string) => void;
  /** In-tab agent terminal handle (embedded path); null when detached. Lets the app route keys to it. */
  onAgentTerminal?: (handle: AgentTerminalHandle | null) => void;
  /** Rail column width; the app derives it from the persisted review layout. */
  width?: number;
  /**
   * When set, renders the muted `>` chevron pinned at the rail's bottom-left,
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
    curationItems,
    selectedCurationId,
    annotationPositions,
    railTab,
    cardEdit,
    submitConfirm,
    onTabChange,
    onSelectCard,
    onActivateCard,
    onSelectCuration,
    onUndoCuration,
    onSubmitRequest,
    onLaunchHarness,
    onAgentTerminal,
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

  const renderAnnotationCard = (annotation: Annotation): React.ReactNode => (
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
        // border-title author: a collaborator's name, "agent" for agent notes, else "me"
        author: annotation.author
          ? resolveDisplayName(annotation.author, session.participants, authorNames)
          : isAgentNote(annotation)
            ? "agent"
            : "me",
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
          annotation.id === selectedId
            ? onActivateCard(annotation.id)
            : onSelectCard(annotation.id),
      }}
    />
  );

  // one position-ordered stack: annotation and removal cards interleaved by their
  // source line (diff row / plan block), original order breaking ties
  const railEntries: { sort: number; order: number; node: React.ReactNode }[] = [
    ...openAnnotations.map((annotation, order) => ({
      sort: annotationPositions?.get(annotation.id) ?? Number.MAX_SAFE_INTEGER,
      order,
      node: renderAnnotationCard(annotation),
    })),
    ...curationItems.map((item, index) => ({
      sort: item.revealIndex,
      order: openAnnotations.length + index,
      node: (
        <RemovalCard
          key={item.id}
          item={item}
          isSelected={item.id === selectedCurationId}
          onSelect={onSelectCuration}
          onUndo={onUndoCuration}
          theme={theme}
        />
      ),
    })),
  ].sort((left, right) => left.sort - right.sort || left.order - right.order);

  return (
    <box
      style={{
        width,
        backgroundColor: tokens.panel,
        flexDirection: "column",
        paddingBottom: 1,
      }}
    >
      <Tabs
        selectedKey={railTab}
        onSelectionChange={(key) => onTabChange(key as RailTab)}
        theme={theme}
      >
        <TabList>
          <Tab id="review">Review</Tab>
          <Tab id="agent">Agent</Tab>
        </TabList>
      </Tabs>
      {railTab === "agent" ? (
        <box style={{ flexGrow: 1, flexDirection: "column" }}>
          <AgentLauncher
            session={session}
            onLaunchHarness={onLaunchHarness}
            onAgentTerminal={onAgentTerminal}
            theme={theme}
          />
        </box>
      ) : openAnnotations.length === 0 && curationItems.length === 0 ? (
        <box style={{ flexGrow: 1, alignItems: "center", justifyContent: "center" }}>
          <text fg={tokens.textDim}>
            {session.annotations.length === 0 ? "no annotations yet" : "all annotations addressed"}
          </text>
        </box>
      ) : (
        <box style={{ flexGrow: 1, flexDirection: "column" }}>
          {addressedCount > 0 ? (
            <text fg={tokens.textDim}>✓ {addressedCount} addressed by revision</text>
          ) : null}
          <scrollbox ref={scrollRef} style={{ flexGrow: 1 }} focused={false}>
            {railEntries.map((entry) => entry.node)}
          </scrollbox>
        </box>
      )}
      {/* the confirm card keeps full width, above the footer row */}
      {railTab !== "agent" && submitConfirm ? (
        <ConfirmCard {...submitConfirm} theme={theme} />
      ) : null}
      {/* footer row: collapse chevron left-bound, the submit affordance inline
          beside it, both on the rail's last row (the plan's bottom-border height) */}
      <box style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
        {onCollapse ? (
          <box onMouseUp={onCollapse}>
            <text fg={tokens.textDim}>{">"}</text>
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

/** A removal preview reads as removed content: struck through and dimmed. */
const REMOVAL_ATTRIBUTES = createTextAttributes({ strikethrough: true, dim: true });

/** Preview lines a removal card shows before it collapses to a "+N more" row. */
const REMOVAL_PREVIEW_LINES = 4;

/** Rough content width inside a removal card's border + padding, for truncation. */
const REMOVAL_PREVIEW_WIDTH = 24;

/**
 * A removed piece as a full display card - the same border/padding/selection
 * chrome as a saved annotation card - previewing the removed content struck
 * through. Unified across diff (a curated-out hunk/change) and plan (a cut
 * block). Clicking selects (App reveals its source line); the undo key restores.
 */
function RemovalCard({
  item,
  isSelected,
  onSelect,
  onUndo,
  theme,
}: {
  item: CurationItem;
  isSelected: boolean;
  onSelect: (id: string) => void;
  onUndo: (id: string) => void;
  theme?: Theme;
}): React.ReactNode {
  const tokens = useComponentTheme(theme);
  const previewLines = item.preview.slice(0, REMOVAL_PREVIEW_LINES);
  const overflow = item.preview.length - previewLines.length;
  // body = the struck-through preview (at least one row) + an overflow row, plus
  // the undo button's own row when selected (mirrors the draft card's Save/Cancel)
  const contentRows =
    Math.max(1, previewLines.length) + (overflow > 0 ? 1 : 0) + (isSelected ? 1 : 0);
  // border = "what + who": a diff reject or a plan cut, always the reviewer's own
  const title = ` ${item.source === "diff" ? "REJECT" : "CUT"} · me `;
  return (
    <box id={`removal-card-${item.id}`} onMouseUp={() => onSelect(item.id)}>
      <Card
        title={title}
        contentRows={contentRows}
        borderColor={isSelected ? tokens.red : tokens.border}
        backgroundColor="transparent"
        theme={theme}
      >
        {previewLines.length === 0 ? (
          <text fg={tokens.textDim}> </text>
        ) : (
          previewLines.map((line, lineIndex) => (
            <text key={lineIndex} fg={tokens.textDim}>
              <span attributes={REMOVAL_ATTRIBUTES}>
                {truncateToSingleLine(line, REMOVAL_PREVIEW_WIDTH)}
              </span>
            </text>
          ))
        )}
        {overflow > 0 ? <text fg={tokens.textDim}>{`  …+${overflow} more`}</text> : null}
        {isSelected ? (
          <Toolbar>
            <Button variant="solid" onPress={() => onUndo(item.id)} theme={theme}>
              {" undo "}
            </Button>
          </Toolbar>
        ) : null}
      </Card>
    </box>
  );
}
