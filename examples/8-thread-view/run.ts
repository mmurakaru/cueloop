#!/usr/bin/env bun
/**
 * Example 8: the thread view - the plan surface with inline comment threads,
 * caret-driven commenting, the slash palette, and scroll markers.
 *   bun run examples/8-thread-view/run.ts
 * Uses an isolated home under /tmp so it never touches your real inbox.
 *
 * Try: click a word and type · drag across a paragraph and its bullets ·
 * cmd+enter sends, enter breaks the line ·
 * "/" first opens the quick-action palette · cmd+option+m comments on the
 * selection · enter on a threaded block replies · click a thread and type
 * to continue your comment · tab folds · cmd+] cycles threads · hover the
 * right-edge dots · ctrl+q quits.
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

const PLAN = `# Implementation Plan: Session Persistence

## Context

Review sessions currently live only in daemon memory. If the daemon crashes
mid-review, every pending annotation is lost. This plan makes sessions
durable without changing the daemon's socket protocol.

## Phase 1: Storage layer

All persistence lives in a new server/storage/ module. Sessions are written
as one JSON document per session, through a temp file and an atomic rename,
so a crash can never leave a torn file on disk.

- server/storage/store.ts - the SessionStore class
- server/storage/schema.ts - the on-disk record shape

## Phase 2: Recovery

On startup the daemon scans the storage directory and rehydrates every
session it finds. Malformed records are skipped per entry, never dropping
the whole store.

## Open questions

- Should recovered sessions expire after a TTL?
- Do we fsync on every annotation, or batch on a debounce?
`;

const session = server.core.sessionCreate({
  workspace: { repoRoot: process.cwd(), branch: "example" },
  artifact: {
    type: "plan",
    content: PLAN,
    meta: { title: "Session Persistence", planPath: "plan.md", agent: "pi" },
  },
});

const blocks = parseBlocks(PLAN);
const blockWith = (needle: string): number =>
  blocks.findIndex((block) => block.text.includes(needle));

// a thread on "an atomic rename": my comment plus a collaborator's reply on
// the same anchor, so the card shows both voices with segmented edges
const atomicBlock = blockWith("an atomic rename");
const atomicStart = blocks[atomicBlock]!.text.indexOf("an atomic rename");
const atomicAnchor = makeAnchor(blocks, atomicBlock, atomicStart, atomicStart + 16);

server.core.sessionAnnotate(session.id, {
  id: "own_1",
  kind: "comment",
  anchor: atomicAnchor,
  body: "what happens on a partial write here?",
});
server.core.sessionMergeShared(session.id, {
  participants: [{ id: "SHA256:ana", provider: "ssh", name: "Ana" }],
  annotations: [
    {
      id: "ana_1",
      kind: "comment",
      anchor: atomicAnchor,
      body: "worth stating that guarantee in the plan itself",
      author: "SHA256:ana",
      replyTo: "own_1",
      createdAt: "2026-09-01T10:00:00Z",
    },
    {
      id: "ana_2",
      kind: "comment",
      anchor: makeAnchor(
        blocks,
        blockWith("Should recovered sessions"),
        0,
        blocks[blockWith("Should recovered sessions")]!.text.length,
      ),
      body: "30 days, same as the share TTL?",
      author: "SHA256:ana",
      createdAt: "2026-09-01T10:01:00Z",
    },
  ],
});

console.log(`seeded ${session.id} - opening the thread view (ctrl+q quits)`);
await runClient({ home, sessionId: session.id });
server.stop();
