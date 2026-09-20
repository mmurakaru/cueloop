/**
 * The body an editor tab paints: the whole working-tree/artifact diff for the
 * Changes tab, or a single file's diff (or read-only contents) for a file tab.
 * Shared by the thread workbench and the bare-launch shell so both render a
 * changed file the same way, with comments routed back through one surface.
 */

import React, { useMemo } from "react";
import { type Anchor } from "@cueloop/schema";
import { dimmedTheme, type Theme } from "../theme";
import { changesMarks, type DiffRow } from "../view-diff";
import {
  DiffContentView,
  type DiffFoldControls,
  type DiffContentViewProps,
} from "./DiffContentView";
import { AnnotatableFileView } from "./AnnotatableFileView";
import type { EditorTab } from "./editor-grid";

/** The inline-commenting props the diff sheet shares with the thread view, wired once by the app. */
export type DiffSurfaceProps = Pick<
  DiffContentViewProps,
  | "session"
  | "quickActions"
  | "observer"
  | "commentsEnabled"
  | "resolved"
  | "suspended"
  | "onComposingChange"
  | "onObserverBlocked"
  | "onCursorChange"
  | "focusedAnnotationId"
  | "onFocusAnnotation"
  | "onAnnotate"
  | "onReply"
  | "onUpdateAnnotation"
  | "resolveAuthorLabel"
  | "onNavCommand"
  | "onExit"
>;

/** The Changes tab body: the whole diff in one scroll container, or a bare hint when nothing changed. */
export function ChangesTabBody(props: {
  rows: DiffRow[];
  surface: DiffSurfaceProps;
  rejectedRows: Set<number>;
  fold?: DiffFoldControls;
  fileStats?: ReadonlyMap<string, { additions: number; deletions: number }>;
  split?: boolean;
  dimmed: boolean;
  /** Rows the sibling Thread pane spends on its footer, so this empty hint centers level with it. */
  emptyBottomPadding?: number;
  theme: Theme;
}): React.ReactNode {
  const session = props.surface.session;
  const marks = useMemo(
    () => changesMarks(session, props.rows, props.surface.focusedAnnotationId),
    [session, props.rows, props.surface.focusedAnnotationId],
  );

  if (props.rows.length === 0) {
    return (
      <box
        style={{
          flexGrow: 1,
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          paddingBottom: props.emptyBottomPadding,
        }}
      >
        <text fg={props.theme.textDim}>No changes</text>
      </box>
    );
  }

  return (
    <DiffContentView
      rows={props.rows}
      marks={marks}
      {...props.surface}
      rejectedRows={props.rejectedRows}
      fold={props.fold}
      fileStats={props.fileStats}
      split={props.split}
      theme={props.dimmed ? dimmedTheme(props.theme) : undefined}
    />
  );
}

/** An editor tab's body: the whole diff for the Changes tab, a file's diff or contents for a file tab. */
export function GridTabContent(props: {
  tab: EditorTab;
  rows: DiffRow[];
  surface: DiffSurfaceProps;
  rejectedRows: Set<number>;
  fold?: DiffFoldControls;
  fileStats?: ReadonlyMap<string, { additions: number; deletions: number }>;
  split?: boolean;
  dimmed: boolean;
  readFile: (path: string) => Promise<string | null>;
  /** Persist a comment on a project file; the file view built the anchor against its own lines. */
  onAddFileComment: (path: string, anchor: Anchor, body: string) => void;
  /** Rows the sibling Thread pane spends on its footer, so the empty hint centers level with it. */
  emptyBottomPadding?: number;
  theme: Theme;
}): React.ReactNode {
  const { tab } = props;
  if (tab.kind === "file" && tab.fileView === "contents" && tab.path !== undefined) {
    const filePath = tab.path;

    return (
      <AnnotatableFileView
        path={filePath}
        loadContents={props.readFile}
        session={props.surface.session}
        quickActions={props.surface.quickActions}
        observer={props.surface.observer}
        resolved={props.surface.resolved}
        suspended={props.surface.suspended}
        focusedAnnotationId={props.surface.focusedAnnotationId}
        onFocusAnnotation={props.surface.onFocusAnnotation}
        onComposingChange={props.surface.onComposingChange}
        onCursorChange={props.surface.onCursorChange}
        onObserverBlocked={props.surface.onObserverBlocked}
        onAddComment={(anchor, body) => props.onAddFileComment(filePath, anchor, body)}
        onReply={props.surface.onReply}
        onUpdateAnnotation={props.surface.onUpdateAnnotation}
        resolveAuthorLabel={props.surface.resolveAuthorLabel}
        onExit={props.surface.onExit}
        theme={props.theme}
      />
    );
  }
  if (tab.kind !== "file") {
    return (
      <ChangesTabBody
        rows={props.rows}
        surface={props.surface}
        rejectedRows={props.rejectedRows}
        fold={props.fold}
        fileStats={props.fileStats}
        split={props.split}
        dimmed={props.dimmed}
        emptyBottomPadding={props.emptyBottomPadding}
        theme={props.theme}
      />
    );
  }
  // a single-file tab shows that file's rows alone, so its row indices are its own: comments and
  // the caret report back in whole-diff indices, and the fold controls (a band to fold) do not apply
  const fileRowIndices = props.rows.flatMap((row, index) => (row.file === tab.path ? [index] : []));
  const rows = fileRowIndices.map((index) => props.rows[index]!);
  const wholeIndex = (rowIndex: number): number => fileRowIndices[rowIndex] ?? rowIndex;
  const rejectedRows = new Set(
    fileRowIndices.flatMap((index, rowIndex) => (props.rejectedRows.has(index) ? [rowIndex] : [])),
  );

  return (
    <ChangesTabBody
      rows={rows}
      surface={{
        ...props.surface,
        onCursorChange: (rowIndex) => props.surface.onCursorChange?.(wholeIndex(rowIndex)),
        onAnnotate: (span, body) =>
          props.surface.onAnnotate(
            {
              start: { blockIndex: wholeIndex(span.start.blockIndex), char: span.start.char },
              end: { blockIndex: wholeIndex(span.end.blockIndex), char: span.end.char },
            },
            body,
          ),
      }}
      rejectedRows={rejectedRows}
      fileStats={props.fileStats}
      split={props.split}
      dimmed={props.dimmed}
      emptyBottomPadding={props.emptyBottomPadding}
      theme={props.theme}
    />
  );
}
