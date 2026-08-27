#!/usr/bin/env bun
/**
 * Landing snapshot seeder: a sync-engine plan carrying the planner's own note
 * and a collaborator's, so the rail shows an accent "me" card beside a blue
 * name-in-border card. Opens the real TUI; a vhs tape drives it to the marker
 * popover and captures the frame. Isolated home under /tmp.
 */

import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DaemonServer } from "@cueloop/daemon";
import { runClient } from "@cueloop/client";
import { makeAnchor, parseBlocks } from "@cueloop/schema";

const home = mkdtempSync(join(tmpdir(), "cueloop-snapshot-plan-"));
const server = new DaemonServer({ home, idleExitMs: 0 });
server.start();

const PLAN = `# Implementation Plan: Offline Sync Engine

## Context

Clients queue mutations locally and replay them when the connection returns.
Two clients editing the same record must converge without dropping writes.

## Phase 1: The mutation queue

Each client appends mutations to a local log tagged with a Lamport clock. On
reconnect the queue flushes to POST /sync in order, oldest first.

## Phase 2: Conflict resolution

The server merges last-writer-wins per field, keyed on the Lamport clock; a
tie breaks on client id. Rejected writes return in the sync response.

## Open questions

- Do we need per-field CRDTs, or is last-writer-wins enough for launch?
`;

const session = server.core.sessionCreate({
  workspace: { repoRoot: process.cwd(), branch: "sync-engine" },
  artifact: {
    type: "plan",
    content: PLAN,
    meta: { title: "Offline Sync Engine", planPath: "plan.md", agent: "pi" },
  },
});

const blocks = parseBlocks(PLAN);
const at = (needle: string): number => blocks.findIndex((block) => block.text.includes(needle));

// the planner's own note - no author, so the rail tags it "me"
server.core.sessionAnnotate(session.id, {
  id: "own_1",
  kind: "comment",
  anchor: makeAnchor(blocks, at("Lamport clock; a"), 0, 18),
  body: "last-writer-wins drops concurrent edits - is that ok for notes?",
});

// a collaborator with a lowercase handle (no display name -> renders "nelson")
server.core.sessionMergeShared(session.id, {
  annotations: [
    {
      id: "collab_nelson",
      kind: "suggestion",
      anchor: makeAnchor(blocks, at("Lamport clock. On"), 0, 18),
      body: "prefer a hybrid logical clock so wall-time skew can't reorder.",
      author: "nelson",
      createdAt: "2026-01-01T00:00:00Z",
    },
  ],
});

console.log(`seeded ${session.id}`);
await runClient({ home, sessionId: session.id });
server.stop();
