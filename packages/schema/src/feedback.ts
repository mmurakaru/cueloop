/**
 * feedback.md: the ONE structured markdown document the agent receives on
 * resolve (map #2, verified in the edit-mode deep-dive). Directive framing -
 * soft phrasing gets ignored by models: the plan diff is applied verbatim
 * first, then every annotation is addressed, located by quoted text.
 */

import type { Annotation, ReviewSession, VerdictKind } from "./types";
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
}

const quoteLines = (s: string) => "> " + s.replace(/\n/g, "\n> ");

export function renderFeedback(input: FeedbackInput): string {
  const path = input.planPath ?? "plan.md";
  const blocks = parseBlocks(input.workingCopy ?? input.artifactContent);
  const lines: string[] = [];
  lines.push("# Review: " + input.verdictKind.replace("_", " "));
  lines.push("");
  if (input.summary.trim()) {
    lines.push(input.summary.trim());
    lines.push("");
  }

  const diff =
    input.workingCopy !== undefined ? unifiedDiffText(input.artifactContent, input.workingCopy, path) : null;
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

  if (input.annotations.length) {
    lines.push(`## Annotations (${input.annotations.length})`);
    lines.push("");
    lines.push(`Address every item. Locate each one in ${path} by its quoted text.`);
    lines.push("");
    input.annotations.forEach((a, i) => {
      const res = resolveAnchor(a.anchor, blocks);
      const sec = res ? sectionOf(blocks, res.blockIndex) : "";
      const loc = sec ? ` (§ ${sec})` : "";
      const flag = res === null ? " [orphaned anchor: the quoted text is no longer present]" : "";
      if (a.kind === "suggestion") {
        lines.push(`### ${i + 1}. Suggested change${loc}${flag}`);
        lines.push("");
        lines.push("Replace:");
        lines.push(quoteLines(a.anchor.quote));
        lines.push("With:");
        lines.push(quoteLines(a.body));
      } else {
        lines.push(`### ${i + 1}. ${capitalize(a.kind)}${loc}${flag}`);
        lines.push("");
        lines.push(quoteLines(a.anchor.quote));
        lines.push("");
        lines.push(a.body);
      }
      lines.push("");
    });
  }

  if (!diff && !input.annotations.length) {
    lines.push("_No edits or annotations._");
    lines.push("");
  }
  return lines.join("\n");
}

export function feedbackForSession(session: ReviewSession, verdictKind: VerdictKind, summary: string): string {
  return renderFeedback({
    verdictKind,
    summary,
    artifactContent: session.artifact.content,
    workingCopy: session.workingCopy,
    annotations: session.annotations,
    planPath: session.artifact.meta.planPath,
  });
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
