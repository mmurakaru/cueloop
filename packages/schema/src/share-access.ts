/** Whether a github login may view a private share; membership is case-insensitive and an unauthenticated viewer is never allowed. */

import type { SharePolicy } from "./types";

export function isShareViewerAllowed(
  policy: SharePolicy,
  githubLogin: string | undefined,
): boolean {
  if (!policy.requireAuth) return true;

  if (githubLogin === undefined) return false;

  const login = githubLogin.toLowerCase();

  return policy.allowlist.some((allowed) => allowed.toLowerCase() === login);
}
