#!/usr/bin/env bun
/**
 * Example 6: review a rendered HTML prototype. Opens the TUI on a design-system
 * pricing page; click a card to select it, then comment on it.
 *   bun run examples/6-prototype-cards/run.ts
 * Needs a graphics terminal (kitty or ghostty) and an installed Google Chrome.
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

const prototypePath = join(import.meta.dir, "cards.html");
const html = await Bun.file(prototypePath).text();

const session = server.core.sessionCreate({
  workspace: { repoRoot: process.cwd(), branch: "example" },
  artifact: {
    type: "prototype",
    content: html,
    meta: { title: "Pricing cards", prototypePath },
  },
});

console.log(`seeded ${session.id} - opening the TUI (click a card, then comment; q to quit)`);
await runClient({ home, sessionId: session.id });
server.stop();
