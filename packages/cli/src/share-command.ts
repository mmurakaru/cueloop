/**
 * `cueloop share [session-id]` - hand a plan to a teammate as one SSH line.
 * This side just picks the session and delegates to the shared `publishShare`
 * transport (the same one the in-TUI Share button uses); the gateway seals and
 * stores. The transport and output are injected so the orchestration is
 * testable without a live gateway.
 */

import { DaemonClient, type SessionClient } from "@cueloop/daemon/client";
import {
  mergeFromShare,
  publishShare,
  pullShare,
  shareIdFromLine,
  type ShareResult,
  type ShareTarget,
} from "@cueloop/client";
import type { ReviewSession } from "@cueloop/schema";

export interface ShareParams {
  sessionId?: string;
  /** Fork the session first and share the fork: one artifact to two people, with separate discussions. */
  fork?: boolean;
  host?: string;
  port?: number;
  home?: string;
}

export interface ShareDeps {
  publish: (session: ReviewSession, target: ShareTarget) => Promise<ShareResult>;
  out: (message: string) => void;
}

export interface PullDeps {
  pull: (shareId: string, target: ShareTarget) => Promise<ReviewSession>;
  out: (message: string) => void;
}

const defaultDeps: ShareDeps = { publish: publishShare, out: (message) => console.log(message) };
const defaultPullDeps: PullDeps = { pull: pullShare, out: (message) => console.log(message) };

/** Connect to the local daemon, then share the chosen session. */
export async function shareCommand(
  params: ShareParams,
  deps: ShareDeps = defaultDeps,
): Promise<number> {
  const client = await DaemonClient.connect({ home: params.home, autostart: true });

  try {
    return await shareSession(client, params, deps);
  } finally {
    client.close();
  }
}

/** Connect to the local daemon, then pull collaborator notes for the plan. */
export async function sharePullCommand(
  params: ShareParams,
  deps: PullDeps = defaultPullDeps,
): Promise<number> {
  const client = await DaemonClient.connect({ home: params.home, autostart: true });

  try {
    return await pullSession(client, params, deps);
  } finally {
    client.close();
  }
}

/** The share orchestration, over any SessionClient - the seam the tests drive. */
export async function shareSession(
  client: SessionClient,
  params: ShareParams,
  deps: ShareDeps,
): Promise<number> {
  const picked = await pickSession(client, params.sessionId);

  if (!picked) {
    deps.out("no plan to share - open a review first");

    return 1;
  }
  const session = params.fork ? await client.sessionFork(picked.id) : picked;
  const { line, copied } = await deps.publish(session, { host: params.host, port: params.port });
  const shareId = shareIdFromLine(line);

  if (shareId) await client.sessionSetShareId(session.id, shareId);
  if (params.fork) deps.out(`forked ${picked.id} as ${session.id}`);
  deps.out(copied ? `share link copied - ${line}` : line);

  return 0;
}

/**
 * Pull the share's current session and union its annotations into the local
 * plan. Union-by-id keeps the planner's own notes; only collaborators' new
 * ones land. The gateway lets only the fingerprint that shared it pull.
 */
export async function pullSession(
  client: SessionClient,
  params: ShareParams,
  deps: PullDeps,
): Promise<number> {
  const session = await pickSharedSession(client, params.sessionId);

  if (!session) {
    deps.out("no shared plan to pull - run `cueloop share` first");

    return 1;
  }
  const remote = await deps.pull(session.shareId!, { host: params.host, port: params.port });
  const before = new Set(session.annotations.map((annotation) => annotation.id));
  const merged = await client.sessionMergeShared(session.id, mergeFromShare(remote));
  // count notes that were not here before, so a pull carrying removals never miscounts
  const added = merged.annotations.filter((annotation) => !before.has(annotation.id)).length;

  deps.out(
    added > 0 ? `pulled ${added} new annotation${added === 1 ? "" : "s"}` : "no new annotations",
  );

  return 0;
}

/** The named session, or the most recent one when no id is given. */
async function pickSession(
  client: SessionClient,
  sessionId?: string,
): Promise<ReviewSession | null> {
  if (sessionId) return client.sessionGet(sessionId);
  const sessions = await client.sessionList();

  return sessions.at(-1) ?? null;
}

/** The named session (if shared), or the most recent shared one. */
async function pickSharedSession(
  client: SessionClient,
  sessionId?: string,
): Promise<ReviewSession | null> {
  if (sessionId) {
    const session = await client.sessionGet(sessionId);

    return session.shareId ? session : null;
  }
  const sessions = await client.sessionList();

  return sessions.filter((session) => session.shareId).at(-1) ?? null;
}
