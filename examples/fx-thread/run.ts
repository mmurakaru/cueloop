#!/usr/bin/env bun
/** Run an isolated agent Thread with real fx and a localhost model, or opt into a live provider. */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DaemonServer } from "../../packages/daemon/src/server";
import { runClient } from "../../packages/client/src/app/run";
import { createTestFxProvider } from "../../test/helpers/fx-provider";

const live = process.argv.includes("--live");
const provider = live ? undefined : createTestFxProvider({ readFile: true });
const home = mkdtempSync(join(tmpdir(), "cueloop-fx-demo-"));
const workspace = provider?.workspace ?? home;
writeFileSync(
  join(workspace, "retry.ts"),
  "export function retry(task: () => void) {\n  return setTimeout(task, 1000);\n}\n",
);
process.env.CUELOOP_FX_THREAD = "1";
const server = new DaemonServer({
  home,
  idleExitMs: 0,
  threadAgent: {
    enabled: true,
    command: [process.env.CUELOOP_TEST_FX ?? "fx", "acp"],
    env: provider?.env,
  },
});
server.start();
process.once("exit", () => {
  server.stop();
  provider?.close();
  rmSync(home, { recursive: true, force: true });
});
const thread = server.core.sessionCreate({
  workspace: { repoRoot: workspace, branch: "prototype" },
  artifact: {
    type: "plan",
    content:
      "# Retry cancellation\n\nInspect retry.ts and explain how the pending timer should be cancelled.\n\nKeep the retry bounded and test cancellation before changing the implementation.",
    meta: { title: "Retry cancellation" },
  },
});

await runClient({ home, sessionId: thread.id });
