#!/usr/bin/env bun
/**
 * Example 3: a plan carrying the planner's own notes and two collaborators',
 * so the rail shows the accent "me" cards beside the blue name-in-border cards.
 *   bun run examples/3-collab-review/run.ts
 * Uses an isolated home under /tmp so it never touches your real inbox.
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
mid-review, every pending annotation is lost.

## Phase 1: Storage layer

All persistence lives in a new server/storage/ module. Sessions are written
as one JSON document per session, through a temp file and an atomic rename.

## Open questions

- Should recovered sessions expire after a TTL?
`;

const session = server.core.sessionCreate({
  workspace: { repoRoot: process.cwd(), branch: "example" },
  artifact: { type: "plan", content: PLAN, meta: { title: "Session Persistence", planPath: "plan.md" } },
});

const blocks = parseBlocks(PLAN);
const blockWith = (needle: string): number => blocks.findIndex((block) => block.text.includes(needle));

// the planner's own note - no author, so it tags as "me" once collaborators join
server.core.sessionAnnotate(session.id, {
  id: "own_1",
  kind: "comment",
  anchor: makeAnchor(blocks, blockWith("daemon crashes"), 0, 18),
  body: "How often does this actually bite us in practice?",
});

// two collaborators' notes, merged in with their identities
server.core.sessionMergeShared(session.id, {
  participants: [
    { id: "SHA256:priya", provider: "ssh", name: "Priya" },
    { id: "SHA256:sam", provider: "ssh", name: "Sam" },
  ],
  annotations: [
    {
      id: "collab_1",
      kind: "suggestion",
      anchor: makeAnchor(blocks, blockWith("atomic rename"), 0, 18),
      body: "fsync the directory after the rename too.",
      author: "SHA256:priya",
      createdAt: "2026-01-01T00:00:00Z",
    },
    {
      id: "collab_2",
      kind: "comment",
      anchor: makeAnchor(blocks, blockWith("expire after a TTL"), 0, 18),
      body: "A TTL feels risky - prefer explicit cleanup.",
      author: "SHA256:sam",
      createdAt: "2026-01-01T00:00:01Z",
    },
  ],
});

console.log(`seeded ${session.id} - opening the TUI (press ? for keys, q to quit)`);
await runClient({ home, sessionId: session.id });
server.stop();
