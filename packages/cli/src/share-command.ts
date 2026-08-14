/**
 * `cueloop share [session-id]` - hand a plan to a teammate as one SSH line.
 * This side just picks the session and delegates to the shared `publishShare`
 * transport (the same one the in-TUI Share button uses); the gateway seals and
 * stores. The transport and output are injected so the orchestration is
 * testable without a live gateway.
 */

import { DaemonClient, type SessionClient } from "@cueloop/daemon/client";
import { publishShare, type ShareResult, type ShareTarget } from "@cueloop/client";
import type { ReviewSession } from "@cueloop/schema";

export interface ShareParams {
  sessionId?: string;
  host?: string;
  port?: number;
  home?: string;
}

export interface ShareDeps {
  publish: (session: ReviewSession, target: ShareTarget) => Promise<ShareResult>;
  out: (message: string) => void;
}

const defaultDeps: ShareDeps = { publish: publishShare, out: (message) => console.log(message) };

/** Connect to the local daemon, then share the chosen session. */
export async function shareCommand(params: ShareParams, deps: ShareDeps = defaultDeps): Promise<number> {
  const client = await DaemonClient.connect({ home: params.home, autostart: true });
  try {
    return await shareSession(client, params, deps);
  } finally {
    client.close();
  }
}

/** The orchestration, over any SessionClient - the seam the tests drive. */
export async function shareSession(client: SessionClient, params: ShareParams, deps: ShareDeps): Promise<number> {
  const session = await pickSession(client, params.sessionId);
  if (!session) {
    deps.out("no plan to share - open a review first");
    return 1;
  }
  const { line, copied } = await deps.publish(session, { host: params.host, port: params.port });
  deps.out(copied ? `share link copied - ${line}` : line);
  return 0;
}

/** The named session, or the most recent one when no id is given. */
async function pickSession(client: SessionClient, sessionId?: string): Promise<ReviewSession | null> {
  if (sessionId) return client.sessionGet(sessionId);
  const sessions = await client.sessionList();
  return sessions.at(-1) ?? null;
}
