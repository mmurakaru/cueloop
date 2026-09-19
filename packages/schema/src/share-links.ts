import type { ShareLink, Thread } from "./types";

/**
 * A thread's share links, migrating a legacy single share (scalar shareId +
 * access + owner + shareBranch) into a one-element list. Undefined when the
 * thread was never shared. Records already carrying `shares` are returned as-is.
 */
export function threadShareLinks(session: Thread): ShareLink[] | undefined {
  if (session.shares !== undefined) return session.shares;
  if (session.shareId === undefined) return undefined;

  return [
    {
      id: session.shareId,
      requireAuth: session.access !== undefined,
      allowlist: session.access?.githubLogins ?? [],
      owner: session.owner,
      shareBranch: session.shareBranch,
    },
  ];
}

/** The thread with `shares` populated from the legacy fields when absent; a never-shared thread is unchanged. */
export function withShareLinks(session: Thread): Thread {
  if (session.shares !== undefined) return session;
  const shares = threadShareLinks(session);

  return shares ? { ...session, shares } : session;
}
