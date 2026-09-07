import React from "react";
import type { Annotation } from "@cueloop/schema";
import { DARK } from "../theme";
import { annotationPaletteFor } from "../annotation-palette";
import { DEFAULT_QUICK_ACTIONS } from "../config";
import { marksByRows } from "../view-diff";
import type { Story, StoryMeta } from "./story";
import { DiffSheet } from "./DiffSheet";
import { fixtureDiffRows, fixtureDiffSession } from "./story-fixtures";

export const meta: StoryMeta = { title: "Surfaces/DiffSheet" };

const palette = annotationPaletteFor(DARK);
const noop = (): void => {};

/** A comment on the added line, anchored the way the surface anchors a marked word. */
const LINE_COMMENT: Annotation = {
  id: "a_diff_1",
  kind: "comment",
  anchor: { quote: "new Map()", prefix: "  private items = ", suffix: ";" },
  body: "Map needs an eviction story.",
  createdAt: "2026-01-01T00:00:00Z",
};

function sheet(annotations: Annotation[], split = false): React.ReactNode {
  const rows = fixtureDiffRows();
  const session = fixtureDiffSession({ annotations });

  return (
    <DiffSheet
      rows={rows}
      session={session}
      marks={marksByRows(annotations, rows)}
      quickActions={DEFAULT_QUICK_ACTIONS}
      observer={false}
      onAnnotate={noop}
      onReply={noop}
      onUpdateAnnotation={noop}
      onExit={noop}
      split={split}
    />
  );
}

export const SignedRows: Story = {
  render: () => sheet([]),
  expectedColors: [DARK.insertedForeground, DARK.deletedForeground],
  size: { width: 90, height: 16 },
};

// A modified line keeps the diff color on the changed words and dims the
// unchanged prefix to the dim token, so the intra-line change stands out.
export const IntralineWordDiff: Story = {
  render: () => sheet([]),
  expectedColors: [DARK.insertedForeground, DARK.deletedForeground, DARK.textDim],
  size: { width: 90, height: 16 },
};

// The caret opens on the first code line: its cell wears the caret backdrop.
export const CaretOnFirstLine: Story = {
  render: () => sheet([]),
  expectedColors: [palette.caretCell],
  size: { width: 90, height: 16 },
};

// A saved comment marks its words (backdrop + underline) and hangs its discussion
// card under the line, exactly as the thread view does for prose.
export const AnnotatedLine: Story = {
  render: () => sheet([LINE_COMMENT]),
  expectedColors: [palette.markBackdrop, palette.cardEdge],
  size: { width: 90, height: 18 },
};

// Side by side: old on the left, new on the right, divided by a thin rule; the
// comment card spans the full width under its pair.
export const SplitView: Story = {
  render: () => sheet([LINE_COMMENT], true),
  expectedColors: [DARK.insertedForeground, DARK.deletedForeground, palette.markBackdrop],
  size: { width: 120, height: 18 },
};
