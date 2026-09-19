/** The default prototype is a Markdown design doc: with no experimental flag it renders through the thread/markdown path (not the kitty pixel view), its headings and fenced sections show as text, and a quote-anchored comment lands on a line - the same as a plan. A real in-process daemon; char-frame assertions over the real App. */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import React from "react";
import { DaemonServer } from "@cueloop/daemon";
import type { Thread } from "@cueloop/schema";
import { App } from "./App";
import { isolateUserConfig, renderReadyApp, settle, waitForText } from "./test-support";

const DOC = `# PromoCard

A promotional card for a growth surface.

## API

\`\`\`ts
interface PromoCardProps {
  title: string
  onDismiss?: () => void
}
\`\`\`

## Composition

\`\`\`
PromoCard
└─ TextGroup   reuse: Text
\`\`\`
`;

let home: string;
let server: DaemonServer;
let session: Thread;
let restoreUserConfig: () => void;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "cueloop-prototype-md-"));
  restoreUserConfig = isolateUserConfig(home);
  server = new DaemonServer({ home, idleExitMs: 0 });
  server.start();
  session = server.core.sessionCreate({
    workspace: { repoRoot: "/repo", branch: "promo-card" },
    artifact: { type: "prototype", content: DOC, meta: { title: "PromoCard", agent: "pi" } },
  });
});
afterEach(() => {
  restoreUserConfig();
  server.stop();
  rmSync(home, { recursive: true, force: true });
});

describe("markdown prototype review", () => {
  test("renders as a markdown design doc, not the pixel view", async () => {
    const setup = await renderReadyApp(<App home={home} sessionId={session.id} />, {
      width: 120,
      height: 40,
    });

    await waitForText(setup, "PromoCard");
    await settle(setup);
    const frame = setup.captureCharFrame();

    // the markdown path renders the doc's headings and interface as text
    expect(frame).toContain("API");
    expect(frame).toContain("PromoCardProps");
    expect(frame).toContain("Composition");
    // and never falls into the pixel view's status line
    expect(frame).not.toContain("rendering prototype");
    expect(frame).not.toContain("graphics terminal");
  });

  test("a quote-anchored comment stores against the doc, like a plan", async () => {
    server.core.sessionAnnotate(session.id, {
      id: "own_1",
      kind: "comment",
      anchor: { quote: "onDismiss?: () => void", prefix: "", suffix: "" },
      body: "make dismiss required for a modal surface?",
    });

    const setup = await renderReadyApp(<App home={home} sessionId={session.id} />, {
      width: 120,
      height: 40,
    });

    await waitForText(setup, "make dismiss required");
    expect(server.core.sessionGet(session.id).annotations).toHaveLength(1);
    expect(server.core.sessionGet(session.id).annotations[0]!.anchor.selector).toBeUndefined();
  });
});
