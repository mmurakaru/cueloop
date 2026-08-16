/**
 * Attribution labels for annotations. An annotation's `author` is an identity
 * id (an SSH fingerprint today). The rail resolves it against the share's
 * participant registry and the planner's local rename overrides; ADR 0006.
 */

import type { Identity } from "@cueloop/schema";

const FINGERPRINT_PREFIX = "SHA256:";

/** Shown for a known participant who chose not to give a name. */
export const ANONYMOUS_LABEL = "-- anonymous --";

/** A short, stable handle from a raw author id when no name is known. */
export function shortHandle(authorId: string): string {
  const base = authorId.startsWith(FINGERPRINT_PREFIX) ? authorId.slice(FINGERPRINT_PREFIX.length) : authorId;
  return base.slice(0, 8) || authorId;
}

/**
 * The rail label for an author id: a local rename wins, then the collaborator's
 * own name, then anonymous for a known-but-unnamed participant, then a short
 * handle for an id we hold no identity for.
 */
export function resolveDisplayName(authorId: string, participants: Identity[] | undefined, overrides: Record<string, string>): string {
  const override = overrides[authorId];
  if (override) return override;
  const identity = participants?.find((participant) => participant.id === authorId);
  if (identity?.name) return identity.name;
  if (identity) return ANONYMOUS_LABEL;
  return shortHandle(authorId);
}
