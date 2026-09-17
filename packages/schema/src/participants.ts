/**
 * The participant registry: every annotation carries an `author` id, and the
 * rail resolves that id to a display name through `session.participants`. This
 * registers an author in that registry so a name search on "participant" or
 * "author name" lands here.
 */

import type { Identity, Thread } from "./types";

/**
 * Return the session with `author` present in the participant registry, setting
 * the display name when one is given. A nameless call only records presence (the
 * rail renders anonymous) and never erases a name a past visit set. Immutable:
 * the input session is not mutated.
 */
export interface ParticipantSource {
  provider: "ssh" | "github";
  handle?: string;
}

export function registerParticipant(
  session: Thread,
  author: string,
  name?: string,
  source?: ParticipantSource,
): Thread {
  const participants = session.participants ?? [];
  const existing = participants.find((participant) => participant.id === author);
  const trimmed = name?.trim();

  if (existing && !trimmed && !source) return session;
  const resolvedName = trimmed ?? existing?.name;
  const resolvedHandle = source?.handle ?? existing?.handle;
  const next: Identity = { id: author, provider: source?.provider ?? existing?.provider ?? "ssh" };

  if (resolvedName) next.name = resolvedName;
  if (resolvedHandle) next.handle = resolvedHandle;

  return {
    ...session,
    participants: existing
      ? participants.map((participant) => (participant.id === author ? next : participant))
      : [...participants, next],
  };
}
