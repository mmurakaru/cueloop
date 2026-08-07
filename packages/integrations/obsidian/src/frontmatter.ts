/** Frontmatter for exported notes: provenance the vault can query. */

import type { ReviewSession } from "@cueloop/schema";

export function frontmatter(session: ReviewSession, created: Date): string {
  return [
    "---",
    `created: ${created.toISOString()}`,
    "source: cueloop",
    `session: ${session.id}`,
    `verdict: ${session.verdict?.kind ?? "pending"}`,
    "---",
  ].join("\n");
}
