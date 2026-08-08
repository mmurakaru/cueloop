#!/usr/bin/env bun
/**
 * cueloop entry points (#18): `cueloop` opens the TUI on the inbox,
 * `cueloop diff` reviews the working tree, `cueloop review <pr>` a PR,
 * `cueloop session *` mirrors the daemon API for agents and scripts,
 * `cueloop serve` shares a session over ssh (read-only observers),
 * `cueloop daemon` runs the daemon in the foreground.
 */

import { parseArgs, flagStr } from "./args";
import { sessionCommand } from "./session-cmds";
import { workingTreeDiff } from "./working-tree";
import { DaemonClient } from "@cueloop/daemon/client";
import { openReview, resolveWorkspace } from "@cueloop/daemon/review";

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
      if (path === null) {
        console.error("a cueloop daemon already owns this home - nothing to do");
        return 1;
      }
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
      const review = await openReview(client, {
        type: "diff",
        content: diff,
        workspace,
        title: `working tree @ ${workspace.branch}`,
      });
      client.close();
      return runTui(review.id);
    }
    case "serve": {
      const { positional, flags } = parseArgs(argv.slice(1));
      const port = flagStr(flags, "port");
      const { serveClient } = await import("@cueloop/client");
      const handle = await serveClient({
        port: port !== undefined ? Number(port) : undefined,
        host: flagStr(flags, "host"),
        sessionId: positional[0],
      });
      console.log(
        [
          "",
          `observers join with:  ssh -p ${handle.port} ${handle.host === "0.0.0.0" || handle.host === "::" ? "<this-host>" : handle.host}`,
          "",
          "no passwords, no keys: anyone who can reach this address can watch.",
          "share the address deliberately (SSH tunnel, tailnet). observers are",
          "read-only; you stay the one writable controller via `cueloop` locally.",
          "ctrl-c stops serving.",
        ].join("\n"),
      );
      const stop = () => void handle.close().finally(() => process.exit(0));
      process.on("SIGINT", stop);
      process.on("SIGTERM", stop);
      await new Promise(() => {}); // serve until signalled
      return 0;
    }
    case "review": {
      const { reviewCommand } = await import("./pr");
      return reviewCommand(argv.slice(1));
    }
    case "review-post": {
      const { reviewPostCommand } = await import("./pr");
      return reviewPostCommand(argv.slice(1));
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
      "  cueloop review <pr>              review a pull request (--no-tui prints the session)",
      "  cueloop review-post <id> <pr>    post a resolved session's verdict back to the PR",
      "  cueloop serve [session-id]       share over ssh: observers are read-only,",
      "                                   you stay the controller (--port 2222, --host 127.0.0.1;",
      "                                   password-less - share the address deliberately)",
      "  cueloop session <verb> [flags]   script the daemon (create|get|list|wait|annotate|resolve|submit-revision)",
      "  cueloop daemon                   run the daemon in the foreground",
    ].join("\n"),
  );
}

process.exit(await main());
