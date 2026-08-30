/**
 * Verb-first review-open resolution: turn a verb (plan/diff/review) plus an
 * optional id-or-title selector into a single session to open, or a clear
 * miss. Pure over a session list so it unit-tests without a daemon or a TUI -
 * main.ts fetches the sessions and prints the miss messages.
 *
 * Rules, in order:
 *   - no selector opens the latest pending session in scope (most recent
 *     createdAt, verdict still open) - the `--latest` default;
 *   - a selector that exactly equals a session id opens that session, pending
 *     or resolved;
 *   - otherwise the selector matches session titles, case-insensitive: an
 *     exact title wins, else a unique substring match wins, else the substring
 *     candidates are reported as ambiguous.
 * Every lookup is scoped by the caller's `match` predicate, so a verb only
 * ever resolves to its own artifact kind.
 */

import type { ReviewSession } from "@cueloop/schema";

/**
 * The verb scopes, kept disjoint on purpose so a single session never resolves
 * under two verbs. A PR review is a diff artifact that carries a `pr`
 * reference (openReview maps a top-level `pr` into `meta.pr`), so the plain
 * diff scope must exclude those - otherwise `cueloop diff` and `cueloop
 * review` would both open the same pending PR review.
 */
export function isPlanReview(session: ReviewSession): boolean {
  return session.artifact.type === "plan";
}
export function isReplyReview(session: ReviewSession): boolean {
  return session.artifact.type === "reply";
}
export function isPrototypeReview(session: ReviewSession): boolean {
  return session.artifact.type === "prototype";
}
export function isDiffReview(session: ReviewSession): boolean {
  return session.artifact.type === "diff" && session.artifact.meta.pr === undefined;
}
export function isPrReview(session: ReviewSession): boolean {
  return session.artifact.type === "diff" && session.artifact.meta.pr !== undefined;
}

/** Session ids are minted with this prefix; the id-vs-title split lives here. */
export function isSessionId(value: string): boolean {
  return value.startsWith("ses_");
}

export interface OpenTargetQuery {
  /** Only sessions this predicate accepts are eligible - the verb's artifact scope. */
  match: (session: ReviewSession) => boolean;
  /** Positional id-or-title selector; absent means "latest pending". */
  selector?: string;
}

export type OpenTarget =
  | { kind: "session"; sessionId: string }
  | { kind: "no-pending" }
  | { kind: "no-match"; selector: string }
  | { kind: "ambiguous"; selector: string; titles: string[] };

/** Most-recent-first, so the head of a sorted list is always the latest. */
function newestFirst(left: ReviewSession, right: ReviewSession): number {
  return right.createdAt.localeCompare(left.createdAt);
}

export function resolveOpenTarget(sessions: ReviewSession[], query: OpenTargetQuery): OpenTarget {
  const scoped = sessions.filter(query.match);

  if (query.selector === undefined) {
    const latestPending = scoped
      .filter((candidate) => candidate.status === "pending")
      .sort(newestFirst)[0];

    return latestPending
      ? { kind: "session", sessionId: latestPending.id }
      : { kind: "no-pending" };
  }

  const selector = query.selector;
  const byId = scoped.find((candidate) => candidate.id === selector);

  if (byId) return { kind: "session", sessionId: byId.id };

  const loweredSelector = selector.toLowerCase();
  const titled = scoped.filter((candidate) => (candidate.artifact.meta.title ?? "").length > 0);

  const exactTitle = titled
    .filter((candidate) => candidate.artifact.meta.title!.toLowerCase() === loweredSelector)
    .sort(newestFirst)[0];

  if (exactTitle) return { kind: "session", sessionId: exactTitle.id };

  const substringMatches = titled
    .filter((candidate) => candidate.artifact.meta.title!.toLowerCase().includes(loweredSelector))
    .sort(newestFirst);

  if (substringMatches.length === 1) return { kind: "session", sessionId: substringMatches[0]!.id };
  if (substringMatches.length === 0) return { kind: "no-match", selector };

  return {
    kind: "ambiguous",
    selector,
    titles: substringMatches.map((candidate) => candidate.artifact.meta.title!),
  };
}

/**
 * The reviewer-facing line for a miss, in the "working tree is clean - nothing
 * to review" tone. `label` is the human word for the verb's scope ("plan",
 * "diff", "PR"). The "session" outcome has no message - the caller opens it.
 */
export function openTargetMessage(
  label: string,
  target: Exclude<OpenTarget, { kind: "session" }>,
): string {
  switch (target.kind) {
    case "no-pending":
      return `no pending ${label} review - nothing to open`;
    case "no-match":
      return `no ${label} review matches "${target.selector}" - nothing to open`;
    case "ambiguous":
      return [
        `"${target.selector}" matches several ${label} reviews - name one:`,
        ...target.titles.map((title) => `  - ${title}`),
      ].join("\n");
  }
}
