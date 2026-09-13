// A project file shown as its own annotatable surface: the file's lines render through the diff
// sheet as context rows (one line-number gutter, no +/- sign), so selecting text leaves a comment
// anchored to the file exactly as a plan or diff comment is. Used where a review session exists to
// hold the notes; the bare-launch welcome shell uses the read-only FileContentsView instead.

import React, { useEffect, useRef, useState } from "react";
import { makeAnchor, annotationTarget, type Anchor, type Thread } from "@cueloop/schema";
import type { Theme } from "../theme";
import type { QuickAction } from "../config";
import { useComponentTheme } from "./theme-context";
import { DiffContentView } from "./DiffContentView";
import { diffRowBlocks, fileContentsRows, marksByRows } from "../view-diff";

export interface AnnotatableFileViewProps {
  path: string;
  loadContents: (path: string) => Promise<string | null>;
  session: Thread;
  quickActions: QuickAction[];
  observer: boolean;
  resolved?: boolean;
  suspended?: boolean;
  focusedAnnotationId?: string;
  onFocusAnnotation?: (annotationId: string | undefined) => void;
  onComposingChange?: (composing: boolean) => void;
  onCursorChange?: (rowIndex: number) => void;
  onObserverBlocked?: (reason: "observer" | "resolved") => void;
  /** Persist a comment on this file; the view built the anchor against the file's own lines. */
  onAddComment: (anchor: Anchor, body: string) => void;
  onReply: (rootAnnotationId: string, body: string) => void;
  onUpdateAnnotation: (id: string, body: string) => void;
  onExit: () => void;
  theme?: Theme;
}

/** A finished read for a specific path; `lines` is null when the file could not be read. */
interface FileLoad {
  path: string;
  lines: string[] | null;
}

export function AnnotatableFileView(props: AnnotatableFileViewProps): React.ReactNode {
  const tokens = useComponentTheme(props.theme);
  const [loaded, setLoaded] = useState<FileLoad | null>(null);
  const loadRef = useRef(props.loadContents);
  useEffect(() => {
    loadRef.current = props.loadContents;
  });

  useEffect(() => {
    let alive = true;
    void loadRef.current(props.path).then(
      (contents) => {
        if (alive)
          setLoaded({ path: props.path, lines: contents === null ? null : contents.split("\n") });
      },
      () => {
        if (alive) setLoaded({ path: props.path, lines: null });
      },
    );

    return () => {
      alive = false;
    };
  }, [props.path]);

  if (loaded === null || loaded.path !== props.path) {
    return (
      <box style={{ flexGrow: 1, paddingLeft: 1, paddingTop: 1 }}>
        <text fg={tokens.textDim}>loading...</text>
      </box>
    );
  }
  if (loaded.lines === null) {
    return (
      <box
        style={{ flexGrow: 1, alignItems: "center", justifyContent: "center", paddingBottom: 2 }}
      >
        <text fg={tokens.textDim}>File deleted</text>
      </box>
    );
  }

  const rows = fileContentsRows(props.path, loaded.lines.join("\n"));
  // the file's worktree notes: these rows are the current file, so a head-side (deleted-line) note
  // must stay orphaned here rather than rebind to similar surviving text
  const fileNotes = props.session.annotations.filter((annotation) => {
    const target = annotationTarget(annotation);

    return target.kind === "file" && target.path === props.path && target.rev === "worktree";
  });

  return (
    <DiffContentView
      rows={rows}
      session={props.session}
      marks={marksByRows(fileNotes, rows, props.focusedAnnotationId)}
      quickActions={props.quickActions}
      observer={props.observer}
      commentsEnabled
      resolved={props.resolved}
      suspended={props.suspended}
      fileView
      onComposingChange={props.onComposingChange}
      onObserverBlocked={props.onObserverBlocked}
      onCursorChange={props.onCursorChange}
      focusedAnnotationId={props.focusedAnnotationId}
      onFocusAnnotation={props.onFocusAnnotation}
      onAnnotate={(span, body) =>
        props.onAddComment(
          makeAnchor(
            diffRowBlocks(rows),
            span.start.blockIndex,
            span.start.char,
            span.end.char,
            span.end.blockIndex,
          ),
          body,
        )
      }
      onReply={props.onReply}
      onUpdateAnnotation={props.onUpdateAnnotation}
      onExit={props.onExit}
      theme={props.theme}
    />
  );
}
