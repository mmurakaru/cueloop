/**
 * The linear view of a session's active path. Every client reads the artifact
 * text, the working copy, and the comments straight off the record, so the
 * record keeps them materialized; this module recomputes them from the path
 * whenever a tip moves. Comments the path does not reach are shelved, never
 * dropped, so a later move can show them again.
 */

import { derivePath, pathOf, type SessionHistory } from "./history";
import type { Annotation, ReviewSession } from "./types";

export interface PathView {
  /** The last agent revision on the path: what the artifact shows. */
  content: string;
  /** The reviewer's edits over it, when the path's head is a reviewer revision. */
  workingCopy: string | undefined;
  /** The comments open on the path, in path order. */
  annotations: Annotation[];
  /** Every other comment the session knows. */
  shelvedAnnotations: Annotation[];
}

/**
 * Fold the active path over every comment the session holds, on or off the
 * path. Comments on the path whose objects are gone stay gone.
 */
export function viewOfPath(history: SessionHistory, known: Annotation[]): PathView {
  const derived = derivePath(history);
  const agentHead = pathOf(history)
    .filter((entry) => entry.type === "revision" && entry.by === "agent")
    .at(-1);
  const content = agentHead?.type === "revision" ? agentHead.content : derived.head.content;
  const byId = new Map(known.map((annotation) => [annotation.id, annotation]));
  const annotations: Annotation[] = [];

  for (const id of derived.annotationIds) {
    const annotation = byId.get(id);

    if (annotation) {
      annotations.push(annotation);
      byId.delete(id);
    }
  }

  return {
    content,
    workingCopy: derived.head.content === content ? undefined : derived.head.content,
    annotations,
    shelvedAnnotations: [...byId.values()],
  };
}

/** Write a path view back into a record, in place; absent fields are removed. */
export function applyPathView(session: ReviewSession, view: PathView): void {
  session.artifact = { ...session.artifact, content: view.content };
  session.annotations = view.annotations;
  if (view.workingCopy === undefined) delete session.workingCopy;
  else session.workingCopy = view.workingCopy;
  if (view.shelvedAnnotations.length === 0) delete session.shelvedAnnotations;
  else session.shelvedAnnotations = view.shelvedAnnotations;
}
