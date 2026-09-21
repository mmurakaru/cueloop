/**
 * PR review entry: `cueloop review <pr>` fetches the PR diff through the
 * user's `gh` CLI (auth fully delegated), opens a diff session, and posts the
 * message back to the PR as a real review when the session resolves.
 * `cueloop review-post <session-id> <pr>` is the non-interactive post-back
 * half for agents and scripts.
 */

import type { Thread } from "@cueloop/schema";
import { join } from "node:path";
import { createGitHubForgeReviewPort } from "@cueloop/adapters/forge-review";
import { createDeliveredMessageStore } from "@cueloop/adapters/delivered-message-store";
import { DaemonClient } from "@cueloop/daemon/client";
import { cueloopHome } from "@cueloop/daemon/paths";
import { openReview } from "@cueloop/daemon/thread-review";
import { parseArgs } from "./args";

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
    console.error("usage: cueloop review <pr> [--no-tui]");

    return 2;
  }
  let imported: { content: string; title: string };

  try {
    imported = await forge().importPullRequest(pr);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));

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
  });
  const session = review.session;

  client.close();

  if (flags["no-tui"]) {
    console.log(JSON.stringify(session, null, 2));

    return 0;
  }

  const { runClient, reviewLayout } = await import("@cueloop/client");

  await runClient({ sessionId: session.id, layout: reviewLayout() });

  const after = await getSession(session.id);

  if (after.status !== "resolved" || !after.message) {
    console.log(`session ${session.id} is unresolved - nothing was posted to PR ${pr}`);

    return 0;
  }

  return postMessage(after, pr);
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

  if (session.status !== "resolved" || !session.message) {
    console.error(`session ${sessionId} is unresolved - nothing was posted to PR ${pr}`);

    return 1;
  }

  return postMessage(session, pr);
}

async function getSession(id: string): Promise<Thread> {
  const client = await DaemonClient.connect({ autostart: true });

  try {
    return await client.sessionGet(id);
  } finally {
    client.close();
  }
}

/** Post the resolved session's message to the PR: feedback.md is the review body. */
async function postMessage(session: Thread, pr: string): Promise<number> {
  const message = session.message!;

  try {
    await forge().postPullRequestMessage(pr, message);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));

    return 1;
  }
  console.log(`posted ${message.outcome} review to PR ${pr} (session ${session.id})`);

  return 0;
}
