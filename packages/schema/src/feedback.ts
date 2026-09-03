/**
 * feedback.md: the ONE structured markdown document the agent receives on
 * resolve. Directive framing - soft phrasing gets ignored by models: the plan
 * diff is applied verbatim first, then every annotation is addressed, located
 * by quoted text.
 */

import {
  isAddressed,
  isAgentNote,
  type Annotation,
  type ArtifactType,
  type ReviewSession,
  type VerdictKind,
} from "./types";
import { parseBlocks, sectionOf } from "./markdown";
import { resolveAnchor } from "./anchor";
import { unifiedDiffText } from "./diff";

export interface FeedbackInput {
  verdictKind: VerdictKind;
  summary: string;
  /** The submitted artifact content (latest revision). */
  artifactContent: string;
  /** The reviewer's working copy; undefined = no direct edits. For a diff it is
   *  the curated patch (accepted hunks); for a plan it is the edited source. */
  workingCopy?: string;
  /** Artifact kind; defaults to "plan". A diff working copy is already a patch. */
  artifactType?: ArtifactType;
  annotations: Annotation[];
  /** Path the agent knows the artifact by (plan or prototype), for direct reference. */
  artifactPath?: string;
  /** Session id, so the document can teach the addressed-ids resubmit call. */
  sessionId?: string;
}

const quoteLines = (text: string) => "> " + text.replace(/\n/g, "\n> ");

export function renderFeedback(input: FeedbackInput): string {
  // The document the agent revises: a reply's feedback references reply.md so
  // the resubmit instruction never points a reply review at plan.md.
  const path = input.artifactPath ?? (input.artifactType === "reply" ? "reply.md" : "plan.md");
  // agent notes are the submitter's own context - never echoed back as
  // feedback - and annotations a previous revision already addressed stay out
  // of the next document, so the agent only ever sees the open items
  const open = input.annotations.filter(
    (annotation) => !isAgentNote(annotation) && !isAddressed(annotation),
  );
  // a discussion is one item: the root comment, then its replies in order. A
  // reply whose root was addressed leaves with it; only a reply whose root is
  // gone entirely stands on its own
  const openIds = new Set(open.map((annotation) => annotation.id));
  const knownIds = new Set(input.annotations.map((annotation) => annotation.id));
  const annotations = open.filter(
    (annotation) =>
      annotation.replyTo === undefined ||
      (!openIds.has(annotation.replyTo) && !knownIds.has(annotation.replyTo)),
  );
  const repliesTo = (root: Annotation): Annotation[] =>
    open
      .filter((annotation) => annotation.replyTo === root.id)
      .toSorted((left, right) => left.createdAt.localeCompare(right.createdAt));
  const isDiff = input.artifactType === "diff";
  const isPrototype = input.artifactType === "prototype";
  // A diff's annotations anchor to the submitted patch rows; resolve against it,
  // not the curated working copy (which may drop the rejected rows).
  const blocks = parseBlocks(
    isDiff ? input.artifactContent : (input.workingCopy ?? input.artifactContent),
  );
  const lines: string[] = [];

  lines.push("# Review: " + input.verdictKind.replace("_", " "));
  lines.push("");
  if (input.summary.trim()) {
    lines.push(input.summary.trim());
    lines.push("");
  }

  let hasEdits = false;

  if (isDiff && input.workingCopy !== undefined) {
    // The diff working copy is already the curated patch - the accepted subset
    // of the submitted changes - so hand it back verbatim, not a diff of diffs.
    hasEdits = true;
    lines.push("## Curated changes");
    lines.push("");
    if (input.workingCopy.trim()) {
      lines.push("The reviewer accepted a subset of your proposed changes. Apply this");
      lines.push("exact unified diff; it replaces what you submitted.");
      lines.push("");
      lines.push("```diff");
      lines.push(input.workingCopy);
      lines.push("```");
    } else {
      lines.push("The reviewer rejected all of your proposed changes.");
    }
    lines.push("");
  } else {
    const diff =
      input.workingCopy !== undefined
        ? unifiedDiffText(input.artifactContent, input.workingCopy, path)
        : null;

    if (diff) {
      hasEdits = true;
      // The edits section names the markdown artifact it edited (plan or reply)
      // so the directive is not mislabelled when the artifact is not a plan.
      lines.push(input.artifactType === "reply" ? "## Reply edits" : "## Plan edits");
      lines.push("");
      lines.push(`The reviewer edited ${path} directly. Apply this exact diff first;`);
      lines.push("it is a unified diff against the version you submitted.");
      lines.push("");
      lines.push("```diff");
      lines.push(diff);
      lines.push("```");
      lines.push("");
    }
  }

  if (annotations.length) {
    lines.push(`## Annotations (${annotations.length})`);
    lines.push("");
    lines.push(
      isPrototype
        ? `Address every item. Locate each one in ${path} by its CSS selector.`
        : `Address every item. Locate each one in ${path} by its quoted text.`,
    );
    lines.push("");
    annotations.forEach((annotation, annotationIndex) => {
      // a prototype selector anchor is never resolved or orphaned against blocks
      const selector = annotation.anchor.selector;
      const resolved = selector ? null : resolveAnchor(annotation.anchor, blocks);
      const sectionTitle = resolved ? sectionOf(blocks, resolved.blockIndex) : "";
      const location = selector ? ` (${selector})` : sectionTitle ? ` (§ ${sectionTitle})` : "";
      const orphanFlag =
        !selector && resolved === null
          ? " [orphaned anchor: the quoted text is no longer present]"
          : "";

      lines.push(
        `### ${annotationIndex + 1}. ${capitalize(annotation.kind)}${location}${orphanFlag}`,
      );
      lines.push("");
      lines.push(quoteLines(annotation.anchor.quote));
      lines.push("");
      lines.push(annotation.body);
      lines.push("");
      const replies = repliesTo(annotation);

      if (replies.length > 0) {
        lines.push("Replies:");
        lines.push("");
        for (const reply of replies) lines.push(`- ${reply.body.replace(/\n/g, "\n  ")}`);
        lines.push("");
      }
      lines.push(`annotation id: \`${annotation.id}\``);
      lines.push("");
    });
    if (input.sessionId) {
      lines.push("## Reporting what you addressed");
      lines.push("");
      lines.push("When you resubmit the revised plan, list the annotation ids you acted on -");
      lines.push("they are marked addressed for the reviewer and leave the open list:");
      lines.push("");
      lines.push("```sh");
      lines.push(
        `cueloop session submit-revision ${input.sessionId} --content-file ${path} --addressed <id,id,...>`,
      );
      lines.push("```");
      lines.push("");
    }
  }

  if (!hasEdits && !annotations.length) {
    lines.push("_No edits or annotations._");
    lines.push("");
  }

  return lines.join("\n");
}

export function feedbackForSession(
  session: ReviewSession,
  verdictKind: VerdictKind,
  summary: string,
): string {
  return renderFeedback({
    verdictKind,
    summary,
    artifactContent: session.artifact.content,
    workingCopy: session.workingCopy,
    artifactType: session.artifact.type,
    annotations: session.annotations,
    artifactPath: session.artifact.meta.prototypePath ?? session.artifact.meta.planPath,
    sessionId: session.id,
  });
}

function capitalize(word: string): string {
  return word.charAt(0).toUpperCase() + word.slice(1);
}
