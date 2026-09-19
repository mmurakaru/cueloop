/**
 * The thread pane's inline edit mode: whether the native markdown editor is open
 * over the body, plus the open and exit handlers. Opening is gated to an
 * editable thread (the caller passes canEdit - owner, unresolved, not a diff);
 * exiting saves the edited body as the working copy through the controller, so
 * leaving the editor never loses work. Switching threads closes the editor.
 */

import { useState } from "react";
import type { ReviewController } from "./thread-controller";

export interface ThreadBodyEditing {
  /** True while the inline markdown editor owns the thread pane and its keys. */
  editing: boolean;
  /** Open the editor when the active thread is editable; a no-op otherwise. */
  openEditor: () => void;
  /** Save the edited body as the working copy and close the editor. */
  exitEditor: (text: string) => void;
}

export function useThreadBodyEditing(options: {
  controller: ReviewController;
  sessionId: string | undefined;
  canEdit: boolean;
}): ThreadBodyEditing {
  const { controller, sessionId, canEdit } = options;
  // hold which thread is being edited, so editing is derived: a thread switch changes sessionId and the
  // editor closes on its own, with no effect or ref reaching across the render
  const [editingSessionId, setEditingSessionId] = useState<string | null>(null);
  const editing = editingSessionId !== null && editingSessionId === sessionId;

  return {
    editing,
    openEditor: () => {
      if (canEdit && sessionId !== undefined) setEditingSessionId(sessionId);
    },
    exitEditor: (text) => {
      controller.saveEditedBody(text);
      setEditingSessionId(null);
    },
  };
}
