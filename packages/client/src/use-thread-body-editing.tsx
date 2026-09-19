/**
 * The thread pane's inline edit mode: owns whether the native markdown editor is
 * open over the body, the editor element itself, and the open and exit handles.
 * Opening is gated to an editable thread (the caller passes canEdit - owner,
 * unresolved, not a diff); exiting saves the edited body as the working copy
 * through the controller, so leaving the editor never loses work. The header
 * edit/normal toggle exits through requestExit; switching threads closes the
 * editor. Rendering the editor lives here too, so the pane pulls in one concept
 * rather than wiring the component and its handle ref by hand.
 */

import React, { useRef, useState } from "react";
import type { Theme } from "./theme";
import type { ReviewController } from "./thread-controller";
import { MarkdownThreadEditor, type MarkdownEditorHandle } from "./components/MarkdownThreadEditor";

export interface ThreadBodyEditing {
  /** True while the inline markdown editor owns the thread pane and its keys. */
  editing: boolean;
  /** Open the editor when the active thread is editable; a no-op otherwise. */
  openEditor: () => void;
  /** Save the current text and close - the header edit/normal toggle's exit. */
  requestExit: () => void;
  /** The editor element for the thread pane, bound to the working copy and theme. */
  renderEditor: (theme: Theme) => React.ReactNode;
}

export function useThreadBodyEditing(options: {
  controller: ReviewController;
  sessionId: string | undefined;
  canEdit: boolean;
}): ThreadBodyEditing {
  const { controller, sessionId, canEdit } = options;
  // key editing by thread id so a thread switch closes the editor with no effect or ref
  const [editingSessionId, setEditingSessionId] = useState<string | null>(null);
  const handleRef = useRef<MarkdownEditorHandle | null>(null);
  const editing = editingSessionId !== null && editingSessionId === sessionId;
  const exitEditor = (text: string): void => {
    controller.saveEditedBody(text);
    setEditingSessionId(null);
  };

  return {
    editing,
    openEditor: () => {
      if (canEdit && sessionId !== undefined) setEditingSessionId(sessionId);
    },
    requestExit: () => handleRef.current?.requestExit(),
    renderEditor: (theme) => (
      <MarkdownThreadEditor
        ref={handleRef}
        initialText={controller.working()}
        theme={theme}
        onExitEditor={exitEditor}
      />
    ),
  };
}
