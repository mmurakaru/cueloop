#!/usr/bin/env bun
/**
 * Example 4: a diff whose hunk both modifies a line and inserts an adjacent one,
 * so the intra-line word highlighting and line alignment are visible.
 *   bun run examples/4-diff-intraline/run.ts
 * Uses an isolated home under /tmp so it never touches your real inbox.
 *
 * What to look for:
 * - syntax highlighting: keywords, types, and strings wear their tree-sitter
 *   colors across context, added, and deleted lines.
 * - "maxRequests = 100" -> "= 250": only "100"/"250" wear the diff color on top
 *   of the syntax colors; the rest of the line keeps its highlighting.
 * - the new "burstAllowance" line is a plain add, not a bogus word-diff against
 *   the modified line above it (alignment, not position).
 * - "this.counts" -> "this.counters": a char-level change on one identifier.
 */

import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DaemonServer } from "@cueloop/daemon";
import { runClient } from "@cueloop/client";

const home = mkdtempSync(join(tmpdir(), "cueloop-example-"));
const server = new DaemonServer({ home, idleExitMs: 0 });
server.start();

const PATCH = `diff --git a/src/rate-limiter.ts b/src/rate-limiter.ts
index 1111111..2222222 100644
--- a/src/rate-limiter.ts
+++ b/src/rate-limiter.ts
@@ -1,9 +1,11 @@
 export class RateLimiter {
   private readonly windowMs = 60_000;
-  private readonly maxRequests = 100;
+  private readonly maxRequests = 250;
+  private readonly burstAllowance = 20;

   allow(key: string): boolean {
-    const count = this.counts.get(key) ?? 0;
+    const count = this.counters.get(key) ?? 0;
     return count < this.maxRequests;
   }
 }
`;

const session = server.core.sessionCreate({
  workspace: { repoRoot: process.cwd(), branch: "example" },
  artifact: { type: "diff", content: PATCH, meta: { title: "rate limiter" } },
});

console.log(`seeded ${session.id} - opening the TUI (press ? for keys, q to quit)`);
await runClient({ home, sessionId: session.id });
server.stop();
