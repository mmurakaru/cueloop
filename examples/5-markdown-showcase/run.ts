#!/usr/bin/env bun
/**
 * Example 5: a plan that exercises every Markdown feature the review surface
 * renders - heading tiers, inline styling, lists, and blockquotes.
 *   bun run examples/5-markdown-showcase/run.ts
 * Uses an isolated home under /tmp so it never touches your real inbox.
 * A terminal cannot scale font size, so heading levels read from weight and
 * brightness, not size: h1 bright, h2 muted, h3 dim - all bold.
 */

import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DaemonServer } from "@cueloop/daemon";
import { runClient } from "@cueloop/client";

const home = mkdtempSync(join(tmpdir(), "cueloop-example-"));
const server = new DaemonServer({ home, idleExitMs: 0 });
server.start();

const PLAN = `# H1 - the plan title

## H2 - a section heading

### H3 - a sub-heading

Body text sits at normal weight so the three heading tiers above stand out
against it. Compare the brightness: **h1** is the brightest, h2 is muted, and
h3 is dim - all bold, because a terminal has one font size for every cell.

## Inline styling

This paragraph mixes **strong emphasis**, *light emphasis*, inline \`code\`,
~~struck-through text~~, and a [real link](https://cueloop.dev) that becomes a
clickable terminal hyperlink. Markers like the asterisks and backticks are
concealed, so only the styled words render.

Nested emphasis works too: **bold with *italic* inside** and \`code stays
literal: **not bold** inside a span\`.

## Lists

- first bullet with **bold** in it
- second bullet with a [link](https://example.com)
- third bullet with \`inline code\`

1. first step
2. second step
3. third step

## A blockquote

> Blockquotes render muted and italic, and still carry inline **emphasis**
> and \`code\` the same way body text does.

### Deeper structure (H3 again)

One more h3 here so you can see two sub-headings render identically, distinct
from the h2 sections above them.

## Out of scope

- Font-size scaling (impossible in a terminal grid)
- Images (needs an image protocol; not in this milestone)
`;

const session = server.core.sessionCreate({
  workspace: { repoRoot: process.cwd(), branch: "example" },
  artifact: {
    type: "plan",
    content: PLAN,
    meta: { title: "Markdown showcase", planPath: "showcase.md" },
  },
});

console.log(`seeded ${session.id} - opening the TUI (q to quit)`);
await runClient({ home, sessionId: session.id });
server.stop();
