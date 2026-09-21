/** Frontmatter for exported notes: provenance the vault can query. */

import type { Thread } from "@cueloop/schema";

export function frontmatter(session: Thread, created: Date): string {
  return [
    "---",
    `created: ${created.toISOString()}`,
    "source: cueloop",
    `session: ${session.id}`,
    `message: ${session.message?.outcome ?? "pending"}`,
    "---",
  ].join("\n");
}
