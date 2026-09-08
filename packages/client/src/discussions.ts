/**
 * Discussions: the conversations an annotated surface hosts inline. A root
 * annotation, its replies, and the span they mark, grouped so two roots on the
 * very same text read as one conversation. Pure over the resolved marks, so the
 * plan thread view and the diff sheet group the same way.
 */

import type { Annotation, ReviewSession } from "@cueloop/schema";
import type { Mark } from "./view-plan";
import { comparePositions, type TextSpan } from "./thread-selection";

/** One conversation: a root annotation, its replies, and the span they mark. */
export interface Discussion {
  key: string;
  /** The annotation replies attach to. */
  rootId: string;
  /** The block the card renders under: where the span ends. */
  blockIndex: number;
  span: TextSpan;
  annotations: Annotation[];
}

export function spanKey(span: TextSpan): string {
  return `${span.start.blockIndex}:${span.start.char}:${span.end.blockIndex}:${span.end.char}`;
}

/**
 * Roots group by the span they resolved to (two roots on the very same text
 * read as one conversation); replies join the discussion their replyTo names, or
 * stand as roots when that root is gone.
 */
export function discussionsFrom(session: ReviewSession, marks: Map<number, Mark[]>): Discussion[] {
  const byId = new Map(session.annotations.map((annotation) => [annotation.id, annotation]));
  const spanOf = new Map<string, TextSpan>();

  for (const [displayIndex, blockMarks] of marks) {
    for (const mark of blockMarks) {
      if (!mark.annotationId || spanOf.has(mark.annotationId)) continue;
      spanOf.set(
        mark.annotationId,
        mark.span ?? {
          start: { blockIndex: displayIndex, char: mark.start },
          end: { blockIndex: displayIndex, char: mark.end },
        },
      );
    }
  }
  const resolved = [...spanOf.keys()].map((id) => byId.get(id)!).filter(Boolean);
  const isRoot = (annotation: Annotation): boolean =>
    annotation.replyTo === undefined || !spanOf.has(annotation.replyTo);
  const grouped = new Map<string, Discussion>();
  const discussionOfRoot = new Map<string, Discussion>();

  for (const annotation of resolved.filter(isRoot)) {
    const span = spanOf.get(annotation.id)!;
    const key = spanKey(span);
    const discussion = grouped.get(key) ?? {
      key,
      rootId: annotation.id,
      blockIndex: span.end.blockIndex,
      span,
      annotations: [],
    };

    discussion.annotations.push(annotation);
    grouped.set(key, discussion);
    discussionOfRoot.set(annotation.id, discussion);
  }
  for (const annotation of resolved.filter((candidate) => !isRoot(candidate))) {
    discussionOfRoot.get(annotation.replyTo!)?.annotations.push(annotation);
  }
  for (const discussion of grouped.values()) {
    discussion.annotations.sort((left, right) => left.createdAt.localeCompare(right.createdAt));
  }

  return [...grouped.values()].toSorted((left, right) =>
    comparePositions(left.span.start, right.span.start),
  );
}
