/**
 * `cueloop dev`: open the TUI against an isolated dev home seeded once with a
 * plan and a diff under this repo's project plus a standalone reply thread, so
 * the Projects and Threads sidebar and the thread view are populated without a
 * live agent. It never touches the real ~/.cueloop home.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { DaemonClient } from "@cueloop/daemon/client";
import { resolveWorkspace } from "@cueloop/daemon/review";

/** Bump whenever the seed content below changes, so a long-lived dev home refreshes instead of keeping
 *  stale threads (an old seed's diff had no files, which showed as "No changes"). */
const SEED_VERSION = 2;
const SEED_TITLES = new Set(["Read the repository", "Review the accent change", "A standalone thought"]);

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

/** Seed the dev home, refreshing the seed threads when SEED_VERSION moved on so a stale home never
 *  keeps an old seed (which is why an aged home showed "No changes" - its diff thread had no files). */
async function refreshDevSeed(client: DaemonClient, home: string): Promise<void> {
  const versionFile = join(home, ".seed-version");
  const stored = existsSync(versionFile) ? Number(readFileSync(versionFile, "utf8").trim()) : 0;
  const existing = await client.sessionList();
  if (existing.length > 0 && stored === SEED_VERSION) return;

  await Promise.all(
    existing
      .filter((thread) => SEED_TITLES.has(thread.artifact.meta.title ?? ""))
      .map((thread) => client.sessionDelete(thread.id)),
  );
  await seedDevSessions(client);
  mkdirSync(dirname(versionFile), { recursive: true });
  writeFileSync(versionFile, String(SEED_VERSION));
}

/** `cueloop dev`: seed an isolated dev home (refreshing a stale seed), then open the TUI on it. */
export async function devCommand(): Promise<number> {
  const home = (process.env.CUELOOP_HOME ??= join(homedir(), ".cueloop-dev"));

  const client = await DaemonClient.connect({ autostart: true });
  try {
    await refreshDevSeed(client, home);
  } finally {
    client.close();
  }

  const { runClient } = await import("@cueloop/client");

  return runClient({});
}
