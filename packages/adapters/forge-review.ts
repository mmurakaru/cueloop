import { spawn } from "node:child_process";
import type { Annotation, Message, MessageOutcome } from "@cueloop/schema";
import * as v from "valibot";
import { renderGitHubReviewComment } from "./github-review-comment";
import type { DeliveredMessageStore } from "./delivered-message-store";

interface ForgeCommandResult {
  code: number;
  stdout: string;
  stderr: string;
}

const PullRequestMetadataSchema = v.object({
  number: v.number(),
  title: v.string(),
  body: v.nullable(v.string()),
  url: v.string(),
  author: v.nullable(v.object({ login: v.string() })),
  baseRefName: v.string(),
  baseRefOid: v.string(),
  headRefName: v.string(),
  headRefOid: v.string(),
});

export interface GitHubPullRequest {
  number: number;
  title: string;
  body: string;
  url: string;
  author: string;
  baseRefName: string;
  baseRefOid: string;
  headRefName: string;
  headRefOid: string;
}

const PR_SNAPSHOT_ATTEMPTS = 3;

export type GitHubReviewEvent = "COMMENT" | "APPROVE" | "REQUEST_CHANGES";

interface GitHubInlineReviewComment {
  path: string;
  line: number;
  start_line?: number;
  start_side?: "LEFT" | "RIGHT";
  side: "LEFT" | "RIGHT";
  body: string;
}

interface GitHubReviewPayload {
  commit_id: string;
  event: GitHubReviewEvent;
  body?: string;
  comments: GitHubInlineReviewComment[];
}

const MESSAGE_OUTCOME_FLAG: Record<MessageOutcome, string> = {
  comment: "--comment",
  approved: "--approve",
  changes_requested: "--request-changes",
};

async function runForgeCommand(
  command: string,
  args: string[],
  cwd?: string,
  input?: string,
): Promise<ForgeCommandResult> {
  return await new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.stdin.end(input);
    child.on("error", reject);
    child.on("close", (code) => {
      resolve({ code: code ?? 1, stdout, stderr });
    });
  });
}

/** Use the authenticated gh CLI and journal successful post-back by Message ID. */
export function createGitHubForgeReviewPort(delivered: DeliveredMessageStore, command = "gh") {
  async function readPullRequest(
    pullRequestReference: string,
    cwd?: string,
  ): Promise<GitHubPullRequest> {
    const result = await runForgeCommand(
      command,
      [
        "pr",
        "view",
        pullRequestReference,
        "--json",
        "number,title,body,url,author,baseRefName,baseRefOid,headRefName,headRefOid",
      ],
      cwd,
    );

    if (result.code !== 0) {
      throw new Error(
        result.stderr.trim() || `gh pr view ${pullRequestReference} failed (exit ${result.code})`,
      );
    }
    const metadata = v.parse(PullRequestMetadataSchema, JSON.parse(result.stdout));

    return {
      ...metadata,
      body: metadata.body ?? "",
      author: metadata.author?.login ?? "unknown",
    };
  }

  async function importPullRequest(
    pullRequestReference: string,
    cwd?: string,
  ): Promise<{ content: string; title: string; pullRequest: GitHubPullRequest }> {
    for (let attempt = 0; attempt < PR_SNAPSHOT_ATTEMPTS; attempt++) {
      const before = await readPullRequest(pullRequestReference, cwd);
      const diffResult = await runForgeCommand(command, ["pr", "diff", before.url], cwd);

      if (diffResult.code !== 0) {
        throw new Error(
          diffResult.stderr.trim() || `gh pr diff ${before.url} failed (exit ${diffResult.code})`,
        );
      }
      if (!diffResult.stdout.trim()) {
        throw new Error(`PR ${pullRequestReference} has an empty diff - nothing to review`);
      }
      const after = await readPullRequest(before.url, cwd);

      if (before.headRefOid === after.headRefOid && before.baseRefOid === after.baseRefOid) {
        return { content: diffResult.stdout, title: after.title, pullRequest: after };
      }
    }

    throw new Error(`PR ${pullRequestReference} changed while its diff was loading - try again`);
  }

  async function postPullRequestComments(input: {
    publicationId: string;
    pullRequest: Pick<GitHubPullRequest, "number" | "url" | "headRefOid">;
    comments: Annotation[];
    event?: GitHubReviewEvent;
    body?: string;
    cwd?: string;
  }): Promise<{ url?: string }> {
    const match = /^https:\/\/github\.com\/([^/]+)\/([^/]+)\/pull\/\d+/.exec(input.pullRequest.url);

    if (!match) throw new Error(`Unsupported GitHub pull request URL ${input.pullRequest.url}`);
    const comments = input.comments.map((annotation) => {
      const comment: GitHubInlineReviewComment = {
        path: annotation.reviewComment!.path,
        line: annotation.reviewComment!.line,
        side: annotation.reviewComment!.side,
        body: renderGitHubReviewComment(annotation),
      };

      if (annotation.reviewComment!.startLine !== undefined) {
        comment.start_line = annotation.reviewComment!.startLine;
        comment.start_side = annotation.reviewComment!.side;
      }

      return comment;
    });
    const payload: GitHubReviewPayload = {
      commit_id: input.pullRequest.headRefOid,
      event: input.event ?? "COMMENT",
      comments,
    };

    if (input.body?.trim()) payload.body = input.body.trim();
    let url: string | undefined;
    const publication: Message = {
      id: input.publicationId,
      outcome:
        payload.event === "APPROVE"
          ? "approved"
          : payload.event === "REQUEST_CHANGES"
            ? "changes_requested"
            : "comment",
      summary: input.body ?? "",
      body: JSON.stringify(payload),
      sentAt: new Date().toISOString(),
    };

    await delivered.sendOnce(publication, async () => {
      const result = await runForgeCommand(
        command,
        [
          "api",
          `repos/${match[1]}/${match[2]}/pulls/${input.pullRequest.number}/reviews`,
          "--method",
          "POST",
          "--input",
          "-",
        ],
        input.cwd,
        JSON.stringify(payload),
      );

      if (result.code !== 0) {
        throw new Error(result.stderr.trim() || `GitHub review post failed (exit ${result.code})`);
      }
      const response: unknown = result.stdout.trim() ? JSON.parse(result.stdout) : {};
      const parsed = v.safeParse(v.object({ html_url: v.optional(v.string()) }), response);

      url = parsed.success ? parsed.output.html_url : undefined;
    });

    return { url };
  }

  async function postPullRequestMessage(
    pullRequestReference: string,
    message: Message,
    cwd?: string,
  ): Promise<void> {
    const inject = async () => {
      const result = await runForgeCommand(
        command,
        [
          "pr",
          "review",
          pullRequestReference,
          MESSAGE_OUTCOME_FLAG[message.outcome],
          "--body",
          message.body,
        ],
        cwd,
      );

      if (result.code !== 0) {
        throw new Error(
          result.stderr.trim() ||
            `gh pr review ${pullRequestReference} failed (exit ${result.code})`,
        );
      }
    };

    await delivered.sendOnce(message, inject);
  }

  return { readPullRequest, importPullRequest, postPullRequestMessage, postPullRequestComments };
}
