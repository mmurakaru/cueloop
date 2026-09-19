/** Whether a github login may view a private share; membership is case-insensitive and an unauthenticated viewer is never allowed. */

import type { ShareAccess } from "./types";

export function isShareViewerAllowed(
  access: ShareAccess,
  githubLogin: string | undefined,
): boolean {
  if (githubLogin === undefined) return false;
  const login = githubLogin.toLowerCase();

  return access.githubLogins.some((allowed) => allowed.toLowerCase() === login);
}
