#!/usr/bin/env bun
/**
 * Review a plan with inline comment threads and a collaborator's reply.
 *   bun run examples/thread-comments/run.ts
 * Uses an isolated home under /tmp so it never touches your real inbox.
 *
 * Try: select text to comment, open the existing thread, then send a Message.
 */

import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DaemonServer } from "@cueloop/daemon";
import { runClient } from "@cueloop/client";
import { makeAnchor, parseBlocks } from "@cueloop/schema";

const home = mkdtempSync(join(tmpdir(), "cueloop-example-"));
const server = new DaemonServer({ home, idleExitMs: 0 });
server.start();

const PLAN = `# Project tree refresh

## Context

The Project tree currently loads files once. A tracked file removed after the
panel opens still appears until the session is reopened. Refresh the list while
the tree remains open and preserve expanded folders.

## File listing

The daemon lists tracked files that still exist in the working tree. It returns
repo-relative paths in a stable order and caps the result for large projects.

## Refresh behavior

The client refreshes the list while the panel is visible. An in-flight request
must finish before another begins. If a refresh fails, retain the last good list
so a short daemon disconnect does not clear the panel.

- Keep expanded folder IDs when paths change.
- Remove a deleted file from the tree after the next refresh.

## Open questions

- Should the focused row move to its nearest surviving sibling when deleted?
`;

const session = server.core.sessionCreate({
  workspace: { repoRoot: process.cwd(), branch: "example" },
  artifact: {
    type: "plan",
    content: PLAN,
    meta: { title: "Project tree refresh", planPath: "plan.md", agent: "pi" },
  },
});

const blocks = parseBlocks(PLAN);
const blockWith = (needle: string): number =>
  blocks.findIndex((block) => block.text.includes(needle));

const refreshBlock = blockWith("in-flight request");
const refreshStart = blocks[refreshBlock]!.text.indexOf("in-flight request");
const refreshAnchor = makeAnchor(blocks, refreshBlock, refreshStart, refreshStart + 17);

server.core.sessionAnnotate(session.id, {
  id: "own_1",
  kind: "comment",
  anchor: refreshAnchor,
  body: "Can overlapping refreshes put an older result back after a newer one?",
});
server.core.sessionMergeShared(session.id, {
  participants: [{ id: "SHA256:ana", provider: "ssh", name: "Ana" }],
  annotations: [
    {
      id: "ana_1",
      kind: "comment",
      anchor: refreshAnchor,
      body: "Keep a request in flight until its response has been applied.",
      author: "SHA256:ana",
      replyTo: "own_1",
      createdAt: "2026-09-01T10:00:00Z",
    },
    {
      id: "ana_2",
      kind: "comment",
      anchor: makeAnchor(
        blocks,
        blockWith("Should the focused row"),
        0,
        blocks[blockWith("Should the focused row")]!.text.length,
      ),
      body: "The next visible row would be a predictable fallback.",
      author: "SHA256:ana",
      createdAt: "2026-09-01T10:01:00Z",
    },
  ],
});

console.log(`seeded ${session.id} - opening the thread view (ctrl+q quits)`);
await runClient({ home, sessionId: session.id });
server.stop();
