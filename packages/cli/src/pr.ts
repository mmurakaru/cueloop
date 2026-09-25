/**
 * PR review entry: `cueloop review <pr>` fetches the PR diff through the
 * user's `gh` CLI (auth fully delegated) and opens a diff session. Publishing
 * is a separate explicit operation so resolving a Thread never mutates GitHub.
 */

import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import {
  REVIEW_SEVERITIES,
  type Annotation,
  type ReviewSeverity,
  type Thread,
} from "@cueloop/schema";
import { isAgentReviewComment } from "@cueloop/adapters/github-review-comment";
import type { GitHubReviewEvent } from "@cueloop/adapters/forge-review";
import { parseArgs, stringFlag } from "./args";
import { join } from "node:path";
import { createGitHubForgeReviewPort } from "@cueloop/adapters/forge-review";
import { createDeliveredMessageStore } from "@cueloop/adapters/delivered-message-store";
import { createTerminalThreadSurfacePort } from "@cueloop/adapters/terminal-thread-surface-port";
import { DaemonClient } from "@cueloop/daemon/client";
import { cueloopHome } from "@cueloop/daemon/paths";
import { openReview } from "@cueloop/daemon/thread-review";

function pullRequestBrief(title: string, body: string): string {
  return `# ${title}\n\n## PR description\n\n${body || "No description provided."}`;
}

function textFlag(
  flags: Record<string, string | boolean>,
  name: string,
  fileName: string,
): string | undefined {
  const inline = stringFlag(flags, name);
  const path = stringFlag(flags, fileName);

  if (inline !== undefined && path !== undefined)
    throw new Error(`use either --${name} or --${fileName}, not both`);

  return path === undefined ? inline : readFileSync(path, "utf8");
}

function requiredFlag(flags: Record<string, string | boolean>, name: string): string {
  const value = stringFlag(flags, name);

  if (!value) throw new Error(`--${name} is required`);

  return value;
}

function nextFindingId(annotations: Annotation[]): string {
  const highest = annotations.reduce((maximum, annotation) => {
    const match = /^C(\d+)$/.exec(annotation.id);

    return match ? Math.max(maximum, Number(match[1])) : maximum;
  }, 0);

  return `C${highest + 1}`;
}

function isReviewSeverity(value: string): value is ReviewSeverity {
  return REVIEW_SEVERITIES.some((severity) => severity === value);
}

function reviewEvent(value: string): GitHubReviewEvent | undefined {
  if (value === "comment") return "COMMENT";
  if (value === "approve") return "APPROVE";
  if (value === "request-changes") return "REQUEST_CHANGES";

  return undefined;
}

function reviewSummary(event: GitHubReviewEvent, body?: string): string | undefined {
  const trimmed = body?.trim();

  if (trimmed) return trimmed;
  if (event === "APPROVE") return undefined;

  return "Review submitted with cueloop.";
}

function reviewPublicationId(
  session: Thread,
  event: GitHubReviewEvent,
  commentIds: string[],
  body?: string,
): string {
  const fingerprint = JSON.stringify({
    sessionId: session.id,
    messageId: session.message?.id,
    event,
    head: session.artifact.meta.prHeadSha,
    comments: commentIds.toSorted(),
    body,
  });

  return `github-review:${createHash("sha256").update(fingerprint).digest("hex")}`;
}

async function reanchorReviewComments(
  session: Thread,
  comments: Annotation[],
): Promise<Annotation[]> {
  const { diffRows, resolveReviewAnchorRow } = await import("@cueloop/client");
  const rows = diffRows(session.artifact.content);

  return comments.map((annotation) => {
    const finding = annotation.reviewComment!;
    const resolveLine = (anchor: Annotation["anchor"]) => {
      return resolveReviewAnchorRow(rows, anchor, finding.path, finding.side)?.row;
    };
    const matched = resolveLine(annotation.anchor);

    if (!matched) {
      throw new Error(
        `finding ${annotation.id} is outdated or ambiguous - refresh the finding before posting`,
      );
    }
    const line = finding.side === "RIGHT" ? matched.newLine! : matched.oldLine!;
    let startLine: number | undefined;

    if (finding.startLine !== undefined) {
      if (!finding.startAnchor) {
        throw new Error(
          `finding ${annotation.id} has no start anchor - refresh the finding before posting`,
        );
      }
      const matchedStart = resolveLine(finding.startAnchor);

      if (!matchedStart) {
        throw new Error(
          `finding ${annotation.id} start is outdated or ambiguous - refresh the finding before posting`,
        );
      }
      startLine = finding.side === "RIGHT" ? matchedStart.newLine! : matchedStart.oldLine!;

      if (startLine >= line) {
        throw new Error(
          `finding ${annotation.id} range is outdated - refresh the finding before posting`,
        );
      }
    }

    return {
      ...annotation,
      reviewComment: {
        ...finding,
        line,
        startLine,
      },
    };
  });
}

interface ReviewFindingInput {
  path: string;
  side: "LEFT" | "RIGHT";
  severity: ReviewSeverity;
  line: number;
  startLine?: number;
  title: string;
  body: string;
  suggestion?: string;
  prompt?: string;
  id?: string;
}

function reviewFindingInput(flags: Record<string, string | boolean>): ReviewFindingInput {
  const side = requiredFlag(flags, "side").toUpperCase();
  const severity = requiredFlag(flags, "severity");
  const line = Number(requiredFlag(flags, "line"));
  const startLineFlag = stringFlag(flags, "start-line");
  const startLine = startLineFlag === undefined ? undefined : Number(startLineFlag);
  const body = textFlag(flags, "body", "body-file")?.trim();
  const suggestion = textFlag(flags, "suggestion", "suggestion-file");

  if (!body) throw new Error("--body or --body-file is required");
  if (side !== "LEFT" && side !== "RIGHT") throw new Error("--side must be LEFT or RIGHT");
  if (!isReviewSeverity(severity)) throw new Error("--severity must be p0, p1, or p2");
  if (!Number.isInteger(line) || line < 1) throw new Error("--line must be a positive integer");
  if (startLine !== undefined && (!Number.isInteger(startLine) || startLine < 1))
    throw new Error("--start-line must be a positive integer");
  if (suggestion?.trim() && side !== "RIGHT")
    throw new Error("suggestions must target the RIGHT side of a diff");

  return {
    path: requiredFlag(flags, "path"),
    side,
    severity,
    line,
    startLine,
    title: requiredFlag(flags, "title"),
    body,
    suggestion,
    prompt: textFlag(flags, "prompt", "prompt-file"),
    id: stringFlag(flags, "id"),
  };
}

async function reviewFindingAnnotation(
  session: Thread,
  flags: Record<string, string | boolean>,
): Promise<Omit<Annotation, "createdAt">> {
  const input = reviewFindingInput(flags);
  const { diffRowAnchor, diffRows, fileRowRange } = await import("@cueloop/client");
  const rows = diffRows(session.artifact.content);
  const rowIndex = rows.findIndex(
    (candidate) =>
      candidate.file === input.path &&
      (input.side === "RIGHT"
        ? candidate.newLine === input.line
        : candidate.oldLine === input.line) &&
      (candidate.kind === "add" || candidate.kind === "del" || candidate.kind === "ctx"),
  );

  if (rowIndex === -1)
    throw new Error(
      `${input.path}:${input.line} is not present on the ${input.side} side of this diff`,
    );
  const fileRange = fileRowRange(rows, input.path)!;
  const fileRows = rows.slice(fileRange.start, fileRange.end);
  let startAnchor: Annotation["anchor"] | undefined;

  if (input.startLine !== undefined) {
    if (input.startLine >= input.line) throw new Error("--start-line must be before --line");
    const startRowIndex = rows.findIndex(
      (candidate) =>
        candidate.file === input.path &&
        (input.side === "RIGHT"
          ? candidate.newLine === input.startLine
          : candidate.oldLine === input.startLine),
    );

    if (startRowIndex === -1)
      throw new Error(
        `${input.path}:${input.startLine} is not present on the ${input.side} side of this diff`,
      );
    startAnchor = diffRowAnchor(fileRows, startRowIndex - fileRange.start);
  }
  const id = input.id ?? nextFindingId(session.annotations);
  const existing = session.annotations.find((annotation) => annotation.id === id);

  if (existing && !isAgentReviewComment(existing)) {
    throw new Error(`comment ID ${id} already belongs to another reviewer`);
  }

  return {
    id,
    kind: "comment",
    anchor: diffRowAnchor(fileRows, rowIndex - fileRange.start),
    target: { kind: "file", path: input.path, rev: input.side === "RIGHT" ? "worktree" : "head" },
    body: input.body,
    author: "agent",
    reviewComment: {
      severity: input.severity,
      title: input.title,
      path: input.path,
      line: input.line,
      startLine: input.startLine,
      startAnchor,
      side: input.side,
      suggestion: input.suggestion,
      prompt: input.prompt,
    },
  };
}

export async function reviewCommentCommand(argv: string[]): Promise<number> {
  const { positional, flags } = parseArgs(argv);
  const sessionId = positional[0];

  if (!sessionId) {
    console.error(
      "usage: cueloop review-comment <session-id> --path <file> --line <n> --side LEFT|RIGHT --severity p0|p1|p2 --title <title> --body-file <path>",
    );

    return 2;
  }
  try {
    const client = await DaemonClient.connect({ autostart: true, role: "agent", author: "agent" });

    try {
      const session = await client.sessionGet(sessionId);
      const annotation = await reviewFindingAnnotation(session, flags);

      await client.sessionComment(sessionId, annotation, "agent");
      console.log(annotation.id);
    } finally {
      client.close();
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));

    return 1;
  }

  return 0;
}

/** The gh binary is injectable so tests can stub it. */
function ghBin(): string {
  return process.env.CUELOOP_GH || "gh";
}

function forge(): ReturnType<typeof createGitHubForgeReviewPort> {
  return createGitHubForgeReviewPort(
    createDeliveredMessageStore(join(cueloopHome(), "forge-delivered-messages.json")),
    ghBin(),
  );
}

export async function reviewCommand(argv: string[]): Promise<number> {
  const { positional, flags } = parseArgs(argv);
  const pr = positional[0];

  if (!pr) {
    console.error("usage: cueloop review <pr> [--head-sha <sha>] [--no-tui]");

    return 2;
  }
  let imported: Awaited<ReturnType<ReturnType<typeof forge>["importPullRequest"]>>;

  try {
    imported = await forge().importPullRequest(pr);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));

    return 1;
  }
  const expectedHeadSha = stringFlag(flags, "head-sha");

  if (expectedHeadSha && imported.pullRequest.headRefOid !== expectedHeadSha) {
    console.error(
      `pull request head changed: reviewed ${expectedHeadSha}, current ${imported.pullRequest.headRefOid}; review the current head before opening a Thread`,
    );

    return 1;
  }
  const client = await DaemonClient.connect({ autostart: true });
  // A PR diff is a partial patch with no full file contents, so no `files` here;
  // hunk curation stays disabled for PR reviews (see diff-hunk-curate.ts).
  const review = await openReview(client, {
    type: "diff",
    content: imported.content,
    title: imported.title,
    pr,
    prBrief:
      textFlag(flags, "brief", "brief-file") ??
      pullRequestBrief(imported.title, imported.pullRequest.body),
    prBaseSha: imported.pullRequest.baseRefOid,
    prHeadSha: imported.pullRequest.headRefOid,
    prUrl: imported.pullRequest.url,
  });
  const session = review.session;

  client.close();

  if (flags["no-tui"]) {
    console.log(JSON.stringify(session, null, 2));

    return 0;
  }

  const { runClient, pullRequestReviewLayout } = await import("@cueloop/client");

  await runClient({ sessionId: session.id, layout: pullRequestReviewLayout() });

  return 0;
}

export async function reviewConfigCommand(): Promise<number> {
  const { loadConfig } = await import("@cueloop/client");
  const config = loadConfig();

  console.log(JSON.stringify(config.review));

  return 0;
}

export async function reviewOpenCommand(argv: string[]): Promise<number> {
  const sessionId = argv[0];

  if (!sessionId) {
    console.error("usage: cueloop review-open <session-id>");

    return 2;
  }
  const client = await DaemonClient.connect({ autostart: true });

  try {
    const session = await client.sessionGet(sessionId);
    const result = await createTerminalThreadSurfacePort(client).openThreads(
      sessionId,
      "changes",
      session,
    );

    if (result !== "opened" && result !== "focused") {
      console.error(`open manually: cueloop ${sessionId}`);

      return 1;
    }
  } finally {
    client.close();
  }

  return 0;
}

export async function reviewPostCommand(argv: string[]): Promise<number> {
  const { positional, flags } = parseArgs(argv);
  const sessionId = positional[0];

  if (!sessionId) {
    console.error(
      "usage: cueloop review-post <session-id> [--comments C1,C2] [--event comment|approve|request-changes] [--body <text>|--body-file <path>]",
    );

    return 2;
  }
  const session = await getSession(sessionId);
  const pr = session.artifact.meta.pr;

  if (
    !pr ||
    !session.artifact.meta.prUrl ||
    !session.artifact.meta.prBaseSha ||
    !session.artifact.meta.prHeadSha
  ) {
    console.error(`session ${sessionId} is not a GitHub pull request review`);

    return 1;
  }
  if (session.status !== "resolved" || !session.message) {
    console.error(`session ${sessionId} is unresolved - approve or request changes before posting`);

    return 1;
  }
  const selectedIds = new Set(
    (stringFlag(flags, "comments") ?? "")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean),
  );
  const selectedComments = session.annotations.filter(
    (annotation) =>
      isAgentReviewComment(annotation) &&
      annotation.resolution === undefined &&
      (selectedIds.size === 0 || selectedIds.has(annotation.id)),
  );

  if (selectedIds.size > 0 && selectedComments.length !== selectedIds.size) {
    console.error("one or more selected comment IDs are missing or not publishable agent findings");

    return 1;
  }
  const eventFlag = stringFlag(flags, "event") ?? "comment";
  const event = reviewEvent(eventFlag);

  if (!event) {
    console.error("--event must be comment, approve, or request-changes");

    return 2;
  }
  const body = reviewSummary(event, textFlag(flags, "body", "body-file"));

  try {
    const forgePort = forge();
    const remote = await forgePort.readPullRequest(
      session.artifact.meta.prUrl,
      session.artifact.meta.cwd,
    );

    if (
      remote.baseRefOid !== session.artifact.meta.prBaseSha ||
      remote.headRefOid !== session.artifact.meta.prHeadSha
    ) {
      throw new Error("pull request changed since this review - refresh before posting");
    }
    const comments = await reanchorReviewComments(session, selectedComments);
    const number = Number(new URL(session.artifact.meta.prUrl).pathname.split("/").at(-1));

    if (!Number.isInteger(number)) throw new Error("pull request URL has no numeric PR number");
    const posted = await forgePort.postPullRequestComments({
      publicationId: reviewPublicationId(
        session,
        event,
        comments.map((comment) => comment.id),
        body,
      ),
      pullRequest: {
        number,
        url: session.artifact.meta.prUrl,
        headRefOid: session.artifact.meta.prHeadSha,
      },
      comments,
      event,
      body,
      cwd: session.artifact.meta.cwd,
    });

    console.log(
      `posted ${comments.length} review comment${comments.length === 1 ? "" : "s"} to PR ${pr}${posted.url ? `: ${posted.url}` : ""}`,
    );
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));

    return 1;
  }

  return 0;
}

async function getSession(id: string): Promise<Thread> {
  const client = await DaemonClient.connect({ autostart: true });

  try {
    return await client.sessionGet(id);
  } finally {
    client.close();
  }
}
