/**
 * A test review home: an isolated CUELOOP_HOME with an in-process daemon that
 * owns plan and diff review sessions, which subprocess tests (PTY tier, CLI
 * tier) open by id. Nothing is checked in; the home is a temp dir removed by
 * `cleanup`.
 */

import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DaemonServer } from "@cueloop/daemon";
import type { Artifact, DiffFileContents, ReviewSession } from "@cueloop/schema";

/** An isolated daemon home whose sessions a test opens by id. */
export interface TestReviewHome {
  home: string;
  server: DaemonServer;
  /** A plan review session over `markdown`; the title also becomes the plan path stem. */
  createPlanSession(markdown: string, title?: string): ReviewSession;
  /** A diff review session over `patch`, with per-file contents when the test needs curation. */
  createDiffSession(patch: string, files?: DiffFileContents[], title?: string): ReviewSession;
  /** A non-interactive editor script that appends `marker` to the file it is given; for hand-off tests. */
  createAppendingEditor(marker: string): string;
  cleanup(): void;
}

/** Start a daemon in a fresh temp home. Call `cleanup` in `afterAll`. */
export function createTestReviewHome(): TestReviewHome {
  const home = mkdtempSync(join(tmpdir(), "cueloop-review-home-"));
  const server = new DaemonServer({ home, idleExitMs: 0 });

  server.start();

  return {
    home,
    server,
    createPlanSession(markdown, title = "Plan") {
      return server.core.sessionCreate({
        workspace: { repoRoot: "/repo", branch: "main" },
        artifact: {
          type: "plan",
          content: markdown,
          meta: { title, planPath: `${title.toLowerCase().replaceAll(/\s+/g, "-")}.md` },
        },
      });
    },
    createDiffSession(patch, files, title = "working tree") {
      const artifact: Artifact = { type: "diff", content: patch, meta: { title } };

      if (files) artifact.files = files;

      return server.core.sessionCreate({
        workspace: { repoRoot: "/repo", branch: "main" },
        artifact,
      });
    },
    createAppendingEditor(marker) {
      const script = join(home, "appending-editor.sh");

      writeFileSync(script, `#!/bin/sh\nprintf '\\n\\n${marker}\\n' >> "$1"\n`);
      chmodSync(script, 0o755);

      return script;
    },
    cleanup() {
      server.stop();
      rmSync(home, { recursive: true, force: true });
    },
  };
}
