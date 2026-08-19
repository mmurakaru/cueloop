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
  /** The reviewer's working copy; undefined = no direct edits. */
  workingCopy?: string;
  annotations: Annotation[];
  /** Path the agent knows the plan by, for direct reference. */
  planPath?: string;
  /** Session id, so the document can teach the addressed-ids resubmit call. */
  sessionId?: string;
}

const quoteLines = (text: string) => "> " + text.replace(/\n/g, "\n> ");

export function renderFeedback(input: FeedbackInput): string {
  const path = input.planPath ?? "plan.md";
  // agent notes are the submitter's own context - never echoed back as
  // feedback - and annotations a previous revision already addressed stay out
  // of the next document, so the agent only ever sees the open items
  const annotations = input.annotations.filter(
    (annotation) => !isAgentNote(annotation) && !isAddressed(annotation),
  );
  const blocks = parseBlocks(input.workingCopy ?? input.artifactContent);
  const lines: string[] = [];
  lines.push("# Review: " + input.verdictKind.replace("_", " "));
  lines.push("");
  if (input.summary.trim()) {
    lines.push(input.summary.trim());
    lines.push("");
  }

  const diff =
    input.workingCopy !== undefined
      ? unifiedDiffText(input.artifactContent, input.workingCopy, path)
      : null;
  if (diff) {
    lines.push("## Plan edits");
    lines.push("");
    lines.push(`The reviewer edited ${path} directly. Apply this exact diff first;`);
    lines.push("it is a unified diff against the version you submitted.");
    lines.push("");
    lines.push("```diff");
    lines.push(diff);
    lines.push("```");
    lines.push("");
  }

  if (annotations.length) {
    lines.push(`## Annotations (${annotations.length})`);
    lines.push("");
    lines.push(`Address every item. Locate each one in ${path} by its quoted text.`);
    lines.push("");
    annotations.forEach((annotation, annotationIndex) => {
      const resolved = resolveAnchor(annotation.anchor, blocks);
      const sectionTitle = resolved ? sectionOf(blocks, resolved.blockIndex) : "";
      const location = sectionTitle ? ` (§ ${sectionTitle})` : "";
      const orphanFlag =
        resolved === null ? " [orphaned anchor: the quoted text is no longer present]" : "";
      if (annotation.kind === "suggestion") {
        lines.push(`### ${annotationIndex + 1}. Suggested change${location}${orphanFlag}`);
        lines.push("");
        lines.push("Replace:");
        lines.push(quoteLines(annotation.anchor.quote));
        lines.push("With:");
        lines.push(quoteLines(annotation.body));
      } else {
        lines.push(
          `### ${annotationIndex + 1}. ${capitalize(annotation.kind)}${location}${orphanFlag}`,
        );
        lines.push("");
        lines.push(quoteLines(annotation.anchor.quote));
        lines.push("");
        lines.push(annotation.body);
      }
      lines.push("");
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

  if (!diff && !annotations.length) {
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
    annotations: session.annotations,
    planPath: session.artifact.meta.planPath,
    sessionId: session.id,
  });
}

function capitalize(word: string): string {
  return word.charAt(0).toUpperCase() + word.slice(1);
}
