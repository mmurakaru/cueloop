#!/usr/bin/env bun
/**
 * Example 7: seed a reply session and open the TUI on it. A reply is the
 * agent's previous message pulled back for line-level review; it renders like a
 * plan (markdown), so the reviewer selects spans, comments, and casts a verdict.
 *   bun run examples/7-agent-reply/run.ts
 * Uses an isolated home under /tmp so it never touches your real inbox.
 */

import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DaemonServer } from "@cueloop/daemon";
import { runClient } from "@cueloop/client";

const home = mkdtempSync(join(tmpdir(), "cueloop-example-"));
const server = new DaemonServer({ home, idleExitMs: 0 });
server.start();

const REPLY = `# How I'd add rate limiting

I'd put a token bucket in front of the share-create handler: capacity 20,
refill one token per second, keyed by source IP.

- Reject over-budget requests with a clear "slow down" line, not a silent drop.
- Keep the bucket in memory - a share gateway restart resetting limits is fine.
- Do **not** rate-limit reads; only the write path (create/revision) needs it.

One open question: should a trusted tunnel bypass the limit, or is one policy
for everyone simpler to reason about?
`;

const session = server.core.sessionCreate({
  workspace: { repoRoot: process.cwd(), branch: "example" },
  artifact: {
    type: "reply",
    content: REPLY,
    meta: { title: "How I'd add rate limiting", planPath: "reply.md" },
  },
});

console.log(`seeded ${session.id} - opening the TUI (q to quit)`);
await runClient({ home, sessionId: session.id });
server.stop();
