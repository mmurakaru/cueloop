/**
 * The participant registry: every annotation carries an `author` id, and the
 * rail resolves that id to a display name through `session.participants`. This
 * registers an author in that registry so a name search on "participant" or
 * "author name" lands here.
 */

import type { Identity, ReviewSession } from "./types";

/**
 * Return the session with `author` present in the participant registry, setting
 * the display name when one is given. A nameless call only records presence (the
 * rail renders anonymous) and never erases a name a past visit set. Immutable:
 * the input session is not mutated.
 */
export function registerParticipant(
  session: ReviewSession,
  author: string,
  name?: string,
): ReviewSession {
  const participants = session.participants ?? [];
  const existing = participants.find((participant) => participant.id === author);
  const trimmed = name?.trim();

  if (existing && !trimmed) return session;
  const next: Identity = {
    id: author,
    provider: "ssh",
    ...(trimmed ? { name: trimmed } : existing?.name ? { name: existing.name } : {}),
  };

  return {
    ...session,
    participants: existing
      ? participants.map((participant) => (participant.id === author ? next : participant))
      : [...participants, next],
  };
}
