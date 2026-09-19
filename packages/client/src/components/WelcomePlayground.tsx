// The welcome page as a live annotation playground: the onboarding copy renders through the same
// diff sheet a file uses, so selecting text and typing leaves a comment with the identical gesture a
// real review uses. The notes are ephemeral - there is no file or thread behind onboarding copy, so
// they live only in this component's state and are never stored or re-anchored. The copy teaches the
// two first gestures: select-and-type to comment, and "/" for the quick actions and skills.

import React, { useMemo, useState } from "react";
import {
  makeAnchor,
  newAnnotationId,
  SCHEMA_VERSION,
  type Annotation,
  type Thread,
} from "@cueloop/schema";
import type { Theme } from "../theme";
import type { QuickAction } from "../config";
import { DiffContentView } from "./DiffContentView";
import { diffRowBlocks, fileContentsRows, marksByRows } from "../view-diff";

export interface WelcomePlaygroundProps {
  version: string;
  quickActions: QuickAction[];
  /** Reports whether the playground composer is open, so the shell suspends its inbox keys while typing. */
  onComposingChange?: (composing: boolean) => void;
  suspended?: boolean;
  theme?: Theme;
}

const DOCS_URL = "https://cueloop.dev/docs/";

/** The playground copy: a heading, the two guided prompts, a line to practice on, and the links. */
function welcomeCopy(version: string): string {
  return [
    "Getting started",
    "Comment on agent-authored work.",
    "",
    "This page is a playground. Nothing you write here is saved.",
    "",
    "Select the line below and start typing to leave your first comment:",
    "",
    "    The quick brown fox jumps over the lazy dog.",
    "",
    'While composing, type "/" to see the quick actions and skills.',
    "",
    "Start",
    "  - select a thread",
    "  - inspect files and changes",
    "",
    "Learn",
    `  - docs        ${DOCS_URL}`,
    "",
    "Version",
    `  - cueloop v${version}`,
  ].join("\n");
}

/** An ephemeral thread that holds nothing but the playground's notes, so the surface groups
 *  discussions exactly as a real review does without any of it reaching the daemon. */
function playgroundThread(annotations: Annotation[]): Thread {
  return {
    schemaVersion: SCHEMA_VERSION,
    id: "welcome",
    workspace: { repoRoot: "", branch: "main" },
    artifact: { type: "plan", content: "", meta: {} },
    revisions: [],
    annotations,
    verdict: null,
    status: "pending",
    createdAt: "1970-01-01T00:00:00.000Z",
  };
}

export function WelcomePlayground(props: WelcomePlaygroundProps): React.ReactNode {
  const [annotations, setAnnotations] = useState<Annotation[]>([]);
  const rows = useMemo(
    () => fileContentsRows("welcome", welcomeCopy(props.version)),
    [props.version],
  );
  const session = playgroundThread(annotations);

  return (
    <DiffContentView
      rows={rows}
      session={session}
      marks={marksByRows(annotations, rows)}
      quickActions={props.quickActions}
      observer={false}
      commentsEnabled
      fileView
      suspended={props.suspended}
      onComposingChange={props.onComposingChange}
      onAnnotate={(span, body) =>
        setAnnotations((current) => [
          ...current,
          {
            id: newAnnotationId(),
            kind: "comment",
            anchor: makeAnchor(
              diffRowBlocks(rows),
              span.start.blockIndex,
              span.start.char,
              span.end.char,
              span.end.blockIndex,
            ),
            target: { kind: "welcome" },
            body,
            createdAt: new Date().toISOString(),
          },
        ])
      }
      onReply={(rootAnnotationId, body) =>
        setAnnotations((current) => {
          const root = current.find((annotation) => annotation.id === rootAnnotationId);

          if (!root) return current;

          return [
            ...current,
            {
              id: newAnnotationId(),
              kind: "comment",
              anchor: root.anchor,
              target: { kind: "welcome" },
              body,
              replyTo: rootAnnotationId,
              createdAt: new Date().toISOString(),
            },
          ];
        })
      }
      onUpdateAnnotation={(id, body) =>
        setAnnotations((current) =>
          current.map((annotation) =>
            annotation.id === id ? { ...annotation, body } : annotation,
          ),
        )
      }
      onExit={() => {}}
      theme={props.theme}
    />
  );
}
