/**
 * `cueloop dev`: open the TUI against an isolated dev home seeded once with a
 * plan and a diff under this repo's project plus a standalone reply thread, so
 * the Projects and Threads sidebar and the thread view are populated without a
 * live agent. It never touches the real ~/.cueloop home.
 */

import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { DaemonClient } from "@cueloop/daemon/client";
import { resolveWorkspace } from "@cueloop/daemon/review";

const SEED_PLAN = `# Read the repository

A seeded plan so \`cueloop dev\` always has a thread to open.

## Steps
- open the thread view
- move the cursor into the agent's text
- type to leave a comment
`;

const SEED_REPLY = `A standalone thought, not tied to any repository.

It lands under Threads in the sidebar rather than a project.
`;

const SEED_DIFF_PATH = "packages/client/src/theme.ts";
const SEED_DIFF_OLD = '  accent: "#f5a3a3",\n';
const SEED_DIFF_NEW = '  accent: "#cba6f7",\n';
const SEED_DIFF = `diff --git a/${SEED_DIFF_PATH} b/${SEED_DIFF_PATH}
--- a/${SEED_DIFF_PATH}
+++ b/${SEED_DIFF_PATH}
@@ -1 +1 @@
-${SEED_DIFF_OLD.trimEnd()}
+${SEED_DIFF_NEW.trimEnd()}
`;

async function seedDevSessions(client: DaemonClient): Promise<void> {
  // the current repo carries a root commit, so its threads gather under a project
  const project = await resolveWorkspace(process.cwd());
  // a non-repo directory has no root commit, so its thread stays standalone
  const standalone = await resolveWorkspace(tmpdir());

  await client.sessionCreate(project, {
    type: "plan",
    content: SEED_PLAN,
    meta: { title: "Read the repository" },
  });
  await client.sessionCreate(project, {
    type: "diff",
    content: SEED_DIFF,
    meta: { title: "Review the accent change" },
    files: [
      {
        path: SEED_DIFF_PATH,
        oldContents: SEED_DIFF_OLD,
        newContents: SEED_DIFF_NEW,
        status: "modified",
      },
    ],
  });
  await client.sessionCreate(standalone, {
    type: "reply",
    content: SEED_REPLY,
    meta: { title: "A standalone thought" },
  });
}

/** `cueloop dev`: seed an isolated dev home once, then open the TUI on it. */
export async function devCommand(): Promise<number> {
  process.env.CUELOOP_HOME ??= join(homedir(), ".cueloop-dev");

  const client = await DaemonClient.connect({ autostart: true });
  try {
    const existing = await client.sessionList();
    if (existing.length === 0) await seedDevSessions(client);
  } finally {
    client.close();
  }

  const { runClient } = await import("@cueloop/client");

  return runClient({});
}
