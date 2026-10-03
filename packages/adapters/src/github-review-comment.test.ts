import { describe, expect, test } from "bun:test";
import type { Annotation } from "@cueloop/schema";
import {
  REVIEW_PROMPT_MAX_LINES,
  isAgentReviewComment,
  renderGitHubReviewComment,
} from "./github-review-comment";

function finding(overrides: Partial<Annotation> = {}): Annotation {
  return {
    id: "C1",
    kind: "comment",
    anchor: { quote: "const token = read();", prefix: "", suffix: "" },
    target: { kind: "file", path: "src/auth.ts", rev: "worktree" },
    body: "This accepts an expired token.",
    author: "agent",
    reviewComment: {
      severity: "p0",
      title: "Expired token is accepted",
      path: "src/auth.ts",
      line: 42,
      side: "RIGHT",
      suggestion: "const token = readValidToken();",
      prompt: "Check the expiry before returning the token.",
    },
    createdAt: "2026-09-24T00:00:00.000Z",
    ...overrides,
  };
}

describe("GitHub review comment", () => {
  test("renders the badge, title, explanation, suggestion, and prompt", () => {
    const body = renderGitHubReviewComment(finding());

    expect(body).toContain('src="https://cueloop.dev/badges/p0.svg"');
    expect(body).toContain("**Expired token is accepted**");
    expect(body).toContain("```suggestion\nconst token = readValidToken();\n```");
    expect(body).toContain("<details><summary>Prompt to fix</summary>");
    expect(body).not.toContain("Knowledge Base Used");
  });

  test("caps a generated prompt without truncating the review explanation", () => {
    const prompt = Array.from(
      { length: REVIEW_PROMPT_MAX_LINES + 5 },
      (_, index) => `line ${index}`,
    ).join("\n");
    const annotation = finding({
      body: "Keep this complete.",
      reviewComment: { ...finding().reviewComment!, prompt },
    });
    const body = renderGitHubReviewComment(annotation);

    expect(body).toContain("Keep this complete.");
    expect(body).toContain("line 23");
    expect(body).not.toContain("line 24");
    expect(body).toContain("[prompt truncated by cueloop]");
  });

  test("only the reserved agent identity with review data is publishable", () => {
    expect(isAgentReviewComment(finding())).toBe(true);
    expect(isAgentReviewComment(finding({ author: undefined }))).toBe(false);
    expect(isAgentReviewComment(finding({ reviewComment: undefined }))).toBe(false);
  });
});
