/**
 * Attribution labels for annotations. An annotation's `author` is the
 * collaborator's SSH key fingerprint (ADR 0003); own notes carry none. Until
 * optional display names are captured, the rail shows a short stable handle
 * derived from the fingerprint - swap the derivation for the real name later.
 */

const FINGERPRINT_PREFIX = "SHA256:";

/** A short, stable handle for a collaborator author (their fingerprint). */
export function authorLabel(author: string): string {
  const base = author.startsWith(FINGERPRINT_PREFIX) ? author.slice(FINGERPRINT_PREFIX.length) : author;
  return base.slice(0, 8) || author;
}
