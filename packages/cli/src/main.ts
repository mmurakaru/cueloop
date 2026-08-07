#!/usr/bin/env bun
/**
 * cueloop entry points (#18): `cueloop` opens the TUI on the inbox,
 * `cueloop diff` reviews the working tree, `cueloop review <pr>` a PR,
 * `cueloop session *` mirrors the daemon API for agents and scripts,
 * `cueloop daemon` runs the daemon in the foreground.
 */

import { sessionCommand } from "./session-cmds";
import { resolveWorkspace, workingTreeDiff } from "./workspace";
import { DaemonClient } from "@cueloop/daemon/client";

const argv = process.argv.slice(2);
const cmd = argv[0];

async function main(): Promise<number> {
  switch (cmd) {
    case "session":
      return sessionCommand(argv.slice(1));
    case "daemon": {
      const { DaemonServer } = await import("@cueloop/daemon");
      const server = new DaemonServer({ idleExitMs: 0 });
      const path = server.start();
      console.log(`cueloop daemon (foreground) on ${path}`);
      await new Promise(() => {}); // run until signalled
      return 0;
    }
    case "diff": {
      const workspace = await resolveWorkspace();
      const diff = await workingTreeDiff();
      if (!diff.trim()) {
        console.error("working tree is clean - nothing to review");
        return 1;
      }
      const client = await DaemonClient.connect({ autostart: true });
      const session = await client.sessionCreate(workspace, {
        type: "diff",
        content: diff,
        meta: { title: `working tree @ ${workspace.branch}`, cwd: process.cwd() },
      });
      client.close();
      return runTui(session.id);
    }
    case "review": {
      console.error("cueloop review <pr>: not implemented yet (map #18, post-slice-3)");
      return 2;
    }
    case "--help":
    case "help":
      printHelp();
      return 0;
    case undefined:
      return runTui();
    default: {
      // `cueloop <session-id>` opens the TUI on that session
      if (cmd.startsWith("ses_")) return runTui(cmd);
      printHelp();
      return 2;
    }
  }
}

async function runTui(sessionId?: string): Promise<number> {
  const { runClient } = await import("@cueloop/client");
  return runClient({ sessionId });
}

function printHelp(): void {
  console.log(
    [
      "cueloop - review surface for coding agents",
      "",
      "usage:",
      "  cueloop                          open the inbox",
      "  cueloop <session-id>             open one session",
      "  cueloop diff                     review the working tree",
      "  cueloop review <pr>              review a pull request",
      "  cueloop session <verb> [flags]   script the daemon (create|get|list|wait|annotate|resolve|submit-revision)",
      "  cueloop daemon                   run the daemon in the foreground",
    ].join("\n"),
  );
}

process.exit(await main());
