/**
 * PR review entry: `cueloop review <pr>` fetches the PR diff through the
 * user's `gh` CLI (auth fully delegated), opens a diff session, and posts the
 * verdict back to the PR as a real review when the session resolves.
 * `cueloop review-post <session-id> <pr>` is the non-interactive post-back
 * half for agents and scripts.
 */

import type { ReviewSession, VerdictKind } from "@cueloop/schema";
import { DaemonClient } from "@cueloop/daemon/client";
import { openReview } from "@cueloop/daemon/review";
import { parseArgs } from "./args";

/** The gh binary is injectable so tests can stub it. */
function ghBin(): string {
  return process.env.CUELOOP_GH || "gh";
}

interface GhResult {
  code: number;
  stdout: string;
  stderr: string;
}

async function gh(args: string[]): Promise<GhResult> {
  const proc = Bun.spawn([ghBin(), ...args], { stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);

  return { code, stdout, stderr };
}

/** Verdict kinds map 1:1 onto gh review flags. */
const VERDICT_FLAG: Record<VerdictKind, string> = {
  approve: "--approve",
  request_changes: "--request-changes",
  comment: "--comment",
};

export async function reviewCommand(argv: string[]): Promise<number> {
  const { positional, flags } = parseArgs(argv);
  const pr = positional[0];

  if (!pr) {
    console.error("usage: cueloop review <pr> [--no-tui]");

    return 2;
  }
  const diff = await gh(["pr", "diff", pr]);

  if (diff.code !== 0) {
    console.error(diff.stderr.trim() || `gh pr diff ${pr} failed (exit ${diff.code})`);

    return 1;
  }
  if (!diff.stdout.trim()) {
    console.error(`PR ${pr} has an empty diff - nothing to review`);

    return 1;
  }
  const client = await DaemonClient.connect({ autostart: true });
  // A PR diff is a partial patch with no full file contents, so no `files` here;
  // hunk curation stays disabled for PR reviews (see diff-hunk-curate.ts).
  const review = await openReview(client, {
    type: "diff",
    content: diff.stdout,
    title: `PR ${pr}`,
    pr,
  });
  const session = review.session;

  client.close();

  if (flags["no-tui"]) {
    console.log(JSON.stringify(session, null, 2));

    return 0;
  }

  const { runClient } = await import("@cueloop/client");

  await runClient({ sessionId: session.id });

  const after = await getSession(session.id);

  if (after.status !== "resolved" || !after.verdict) {
    console.log(`session ${session.id} is unresolved - nothing was posted to PR ${pr}`);

    return 0;
  }

  return postVerdict(after, pr);
}

export async function reviewPostCommand(argv: string[]): Promise<number> {
  const { positional } = parseArgs(argv);
  const sessionId = positional[0];
  const pr = positional[1];

  if (!sessionId || !pr) {
    console.error("usage: cueloop review-post <session-id> <pr>");

    return 2;
  }
  const session = await getSession(sessionId);

  if (session.status !== "resolved" || !session.verdict) {
    console.error(`session ${sessionId} is unresolved - nothing was posted to PR ${pr}`);

    return 1;
  }

  return postVerdict(session, pr);
}

async function getSession(id: string): Promise<ReviewSession> {
  const client = await DaemonClient.connect({ autostart: true });

  try {
    return await client.sessionGet(id);
  } finally {
    client.close();
  }
}

/** Post the resolved session's verdict to the PR: feedback.md is the review body. */
async function postVerdict(session: ReviewSession, pr: string): Promise<number> {
  const verdict = session.verdict!;
  const result = await gh([
    "pr",
    "review",
    pr,
    VERDICT_FLAG[verdict.kind],
    "--body",
    verdict.feedback,
  ]);

  if (result.code !== 0) {
    console.error(result.stderr.trim() || `gh pr review ${pr} failed (exit ${result.code})`);

    return 1;
  }
  console.log(`posted ${verdict.kind} review to PR ${pr} (session ${session.id})`);

  return 0;
}
