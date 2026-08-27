#!/usr/bin/env bun
/**
 * Landing snapshot seeder: a buttons-in-states prototype with a "me" note and a
 * collaborator's, anchored to element selectors. Opens the real TUI (needs a
 * graphics terminal + Chrome); captured from a real ghostty window. Isolated home.
 */

import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DaemonServer } from "@cueloop/daemon";
import { runClient } from "@cueloop/client";

const home = mkdtempSync(join(tmpdir(), "cueloop-snapshot-prototype-"));
const server = new DaemonServer({ home, idleExitMs: 0 });
server.start();

const htmlPath = join(import.meta.dir, "buttons.html");

const session = server.core.sessionCreate({
  workspace: { repoRoot: process.cwd(), branch: "buttons" },
  artifact: {
    type: "prototype",
    content: "",
    meta: { title: "buttons.html", prototypePath: htmlPath, agent: "pi" },
  },
});

// the reviewer's own note on the danger button
server.core.sessionAnnotate(session.id, {
  id: "own_1",
  kind: "comment",
  anchor: { quote: "Delete", prefix: "", suffix: "", selector: "button.danger" },
  body: "destructive default needs a confirm step before it fires.",
});

// two collaborators - prototype mode has comments (and quick actions), no cut
server.core.sessionMergeShared(session.id, {
  annotations: [
    {
      id: "collab_nelson",
      kind: "comment",
      anchor: { quote: "Saving…", prefix: "", suffix: "", selector: "button.primary" },
      body: "loading state should keep the label width so the row doesn't jump.",
      author: "nelson",
      createdAt: "2026-01-01T00:00:00Z",
    },
    {
      id: "collab_dana",
      kind: "comment",
      anchor: { quote: "Cancel", prefix: "", suffix: "", selector: "button.outline" },
      body: "outline + ghost read almost the same at a glance - pick one.",
      author: "dana",
      createdAt: "2026-01-01T00:00:01Z",
    },
  ],
});

console.log(`seeded ${session.id}`);
await runClient({ home, sessionId: session.id });
server.stop();
