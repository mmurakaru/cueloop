import {
  annotationTarget,
  parseBlocks,
  resolveAnchor,
  type Annotation,
  type SessionEntry,
} from "@cueloop/schema";
import type { SyncTextRevision } from "@cueloop/sync/text";

/** Accepted operation identities and parent links remain canonical review-history entry identities. */
export function toSyncPlanHistoryEntry(revision: SyncTextRevision): SessionEntry {
  return {
    id: revision.identifier,
    parentId: revision.parentIdentifier,
    type: "revision",
    by: revision.revision === 0 ? "agent" : "reviewer",
    author: revision.actorIdentifier,
    content: revision.content,
    createdAt: new Date(revision.acceptedAt).toISOString(),
  };
}

/** Quote anchors remain saved when shared text changes; unresolved artifact anchors are reported. */
export function orphanedSyncPlanAnnotations(options: {
  annotations: readonly Annotation[];
  content: string;
}): string[] {
  const blocks = parseBlocks(options.content);

  return options.annotations
    .filter(
      (annotation) =>
        annotationTarget(annotation).kind === "artifact" &&
        resolveAnchor(annotation.anchor, blocks) === null,
    )
    .map((annotation) => annotation.id);
}
