#!/usr/bin/env bun
/**
 * Example 1: seed a plan session and open the TUI on it.
 *   bun run examples/1-hello-plan/run.ts
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

const PLAN = `# Implementation Plan: Session Persistence

## Context

Review sessions currently live only in daemon memory. If the daemon crashes
mid-review, every pending annotation is lost.

## Phase 1: Storage layer

All persistence lives in a new server/storage/ module. Sessions are written
as one JSON document per session, through a temp file and an atomic rename.

- server/storage/store.ts - the SessionStore class
- server/storage/schema.ts - the on-disk record shape

## Open questions

- Should recovered sessions expire after a TTL?
`;

const session = server.core.sessionCreate({
  workspace: { repoRoot: process.cwd(), branch: "example" },
  artifact: { type: "plan", content: PLAN, meta: { title: "Session Persistence", planPath: "plan.md" } },
});

console.log(`seeded ${session.id} - opening the TUI (press ? in your head, q to quit)`);
await runClient({ home, sessionId: session.id });
server.stop();
