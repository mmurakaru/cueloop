/**
 * The concept pages, in reading order. One source of truth for the nav on
 * the landing page and inside each concept page.
 */
export interface ConceptPage {
  href: string;
  title: string;
  summary: string;
}

export const conceptPages: ConceptPage[] = [
  {
    href: "/concepts/review-session",
    title: "The ReviewSession",
    summary: "The core primitive: an artifact plus quote-anchored annotations.",
  },
  {
    href: "/concepts/annotations",
    title: "Annotations",
    summary: "Quote-anchored notes with stable, client-minted ids.",
  },
  {
    href: "/concepts/plan-diff-review",
    title: "Plan, diff, review",
    summary: "The three verbs that open a review over an artifact.",
  },
  {
    href: "/concepts/sharing-over-ssh",
    title: "Sharing over SSH",
    summary: "The design direction: hand a review to a terminal, no browser.",
  },
];
