// A project file in the bare launch shell: annotatable like any file, but no thread exists yet. The
// first comment find-or-creates the per-repo workbench thread (controller.commentOnWorkbench), which
// opens it - so this ephemeral view lives only until that first note promotes it to a real thread.

import React from "react";
import { SCHEMA_VERSION, type Anchor, type ReviewSession } from "@cueloop/schema";
import type { Theme } from "../theme";
import type { QuickAction } from "../config";
import type { ReviewController } from "../session-controller";
import { AnnotatableFileView } from "./AnnotatableFileView";

/** An empty, unsaved thread: it holds no notes, just enough shape for the annotation surface. */
function draftThread(): ReviewSession {
  return {
    schemaVersion: SCHEMA_VERSION,
    id: "workbench-draft",
    workspace: { repoRoot: "", branch: "main" },
    artifact: { type: "diff", content: "", meta: {} },
    revisions: [],
    annotations: [],
    verdict: null,
    status: "pending",
    createdAt: "1970-01-01T00:00:00.000Z",
  };
}

export interface BareWorkbenchFileViewProps {
  path: string;
  controller: ReviewController;
  quickActions: QuickAction[];
  onExit: () => void;
  theme?: Theme;
}

export function BareWorkbenchFileView(props: BareWorkbenchFileViewProps): React.ReactNode {
  return (
    <AnnotatableFileView
      path={props.path}
      loadContents={(path) => props.controller.repoReadFile(path)}
      session={draftThread()}
      quickActions={props.quickActions}
      observer={false}
      onAddComment={(anchor: Anchor, body: string) =>
        void props.controller.commentOnWorkbench(
          anchor,
          { kind: "file", path: props.path, rev: "worktree" },
          body,
        )
      }
      onReply={() => {}}
      onUpdateAnnotation={() => {}}
      onExit={props.onExit}
      theme={props.theme}
    />
  );
}
