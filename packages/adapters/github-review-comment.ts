import type { Annotation, ReviewComment } from "@cueloop/schema";

export const REVIEW_AGENT_AUTHOR = "agent";
export const REVIEW_PROMPT_MAX_LINES = 24;

const BADGE_ORIGIN = "https://cueloop.dev/badges";

/** True only for publishable review findings created through the agent review command. */
export function isAgentReviewComment(
  annotation: Annotation,
): annotation is Annotation & { reviewComment: ReviewComment } {
  return annotation.author === REVIEW_AGENT_AUTHOR && annotation.reviewComment !== undefined;
}

function cappedPrompt(prompt: string): string {
  const lines = prompt.trim().split("\n");

  if (lines.length <= REVIEW_PROMPT_MAX_LINES) return lines.join("\n");

  return [...lines.slice(0, REVIEW_PROMPT_MAX_LINES), "[prompt truncated by cueloop]"].join("\n");
}

/** Render one agent finding as the GitHub inline-review body posted by cueloop. */
export function renderGitHubReviewComment(annotation: Annotation): string {
  if (!isAgentReviewComment(annotation)) {
    throw new Error(`GitHub review comment ${annotation.id} is not an agent finding`);
  }
  const finding = annotation.reviewComment;
  const badge = finding.severity.toUpperCase();
  const lines = [
    `<img alt="${badge}" src="${BADGE_ORIGIN}/${finding.severity}.svg" align="top"> **${finding.title}**`,
    "",
    annotation.body.trim(),
  ];

  if (finding.suggestion?.trim()) {
    lines.push("", "```suggestion", finding.suggestion.trimEnd(), "```");
  }
  if (finding.prompt?.trim()) {
    lines.push(
      "",
      "<details><summary>Prompt to fix</summary>",
      "",
      "```text",
      cappedPrompt(finding.prompt),
      "```",
      "</details>",
    );
  }

  return lines.join("\n");
}
