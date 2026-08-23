#!/usr/bin/env bun
/**
 * cueloop entry points: `cueloop` opens the TUI on the inbox, the verb-first
 * openers `cueloop plan|diff|review` open the latest pending review of that
 * type (or address one by id/title), `cueloop diff`/`cueloop review <pr>` also
 * keep their create paths, `cueloop session *` mirrors the daemon API for
 * agents and scripts, `cueloop serve` shares a session over ssh (read-only
 * observers), `cueloop daemon` runs the daemon in the foreground.
 */

import { basename, resolve } from "node:path";
import { parseArgs, stringFlag, type ParsedArgs } from "./args";
import {
  isDiffReview,
  isPlanReview,
  isPrototypeReview,
  isPrReview,
  isSessionId,
  openTargetMessage,
  resolveOpenTarget,
} from "./open-target";
import { sessionCommand } from "./session-commands";
import { CLI_VERSION } from "./version";
import { DaemonClient } from "@cueloop/daemon/client";
import { workingTreeDiff } from "@cueloop/daemon/working-tree";
import type { ReviewSession } from "@cueloop/schema";
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
    case "plan":
      return planCommand(argv.slice(1));
    case "diff":
      return diffCommand(argv.slice(1));
    case "prototype":
      return prototypeCommand(argv.slice(1));
    case "serve": {
      const { positional, flags } = parseArgs(argv.slice(1));
      const port = stringFlag(flags, "port");
      const { serveClient } = await import("@cueloop/client");
      const handle = await serveClient({
        port: port !== undefined ? Number(port) : undefined,
        host: stringFlag(flags, "host"),
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
    case "share": {
      const { positional, flags } = parseArgs(argv.slice(1));
      const { shareCommand, sharePullCommand } = await import("./share-command");
      const port = stringFlag(flags, "port");
      const target = {
        host: stringFlag(flags, "host"),
        port: port !== undefined ? Number(port) : undefined,
      };
      if (positional[0] === "pull")
        return sharePullCommand({ ...target, sessionId: positional[1] });
      return shareCommand({ ...target, sessionId: positional[0] });
    }
    case "wake": {
      const { wakeCommand } = await import("./wake-command");
      return wakeCommand(argv.slice(1));
    }
    case "actions": {
      const { actionsCommand } = await import("./actions-command");
      return actionsCommand(argv.slice(1));
    }
    case "review":
      return reviewEntry(argv.slice(1));
    case "review-post": {
      const { reviewPostCommand } = await import("./pr");
      return reviewPostCommand(argv.slice(1));
    }
    case "-v":
    case "--version":
    case "version":
      console.log(CLI_VERSION);
      return 0;
    case "-h":
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

/**
 * The id-or-title selector for a verb-first opener: the bare positional, or a
 * value handed to `--open`/`--latest`. A bare `--latest`/`--open` flag carries
 * no value, so the selector stays undefined and the opener defaults to the
 * latest pending review.
 */
function openSelector(parsed: ParsedArgs): string | undefined {
  return (
    parsed.positional[0] ?? stringFlag(parsed.flags, "open") ?? stringFlag(parsed.flags, "latest")
  );
}

/**
 * Resolve one review of the verb's scope and open it in the TUI, or print the
 * miss and fail. `emptyMessage` overrides the default no-pending line for the
 * one caller that needs a scope-specific hint (a clean working tree).
 */
async function openReviewOfKind(
  match: (session: ReviewSession) => boolean,
  label: string,
  selector: string | undefined,
  emptyMessage?: string,
): Promise<number> {
  const client = await DaemonClient.connect({ autostart: true });
  let sessions: ReviewSession[];
  try {
    sessions = await client.sessionList();
  } finally {
    client.close();
  }
  const target = resolveOpenTarget(sessions, { match, selector });
  if (target.kind === "session") return runTui(target.sessionId);
  if (target.kind === "no-pending" && emptyMessage !== undefined) {
    console.error(emptyMessage);
    return 1;
  }
  console.error(openTargetMessage(label, target));
  return 1;
}

/** `cueloop plan [id|title]` - open the latest pending plan, or address one. */
async function planCommand(argv: string[]): Promise<number> {
  return openReviewOfKind(isPlanReview, "plan", openSelector(parseArgs(argv)));
}

/**
 * `cueloop prototype <file.html>` creates a review of a rendered HTML file;
 * a selector or `--open`/`--latest` (or a bare call with no file) opens the
 * latest pending prototype review instead.
 */
async function prototypeCommand(argv: string[]): Promise<number> {
  const parsed = parseArgs(argv);
  const selector = openSelector(parsed);
  const wantsOpen = "open" in parsed.flags || "latest" in parsed.flags;
  const looksLikeFile = selector !== undefined && !isSessionId(selector) && selector.endsWith(".html");
  if (wantsOpen || !looksLikeFile) return openReviewOfKind(isPrototypeReview, "prototype", selector);

  const path = resolve(selector);
  const html = await Bun.file(path).text().catch(() => undefined);
  if (html === undefined) {
    console.error(`prototype: cannot read ${path}`);
    return 1;
  }
  const client = await DaemonClient.connect({ autostart: true });
  const review = await openReview(client, {
    type: "prototype",
    content: html,
    prototypePath: path,
    title: basename(path),
  });
  client.close();
  return runTui(review.id);
}

/**
 * `cueloop diff` disambiguates create from open by intent:
 *   - a selector (`cueloop diff <id|title>`) or an explicit `--open`/`--latest`
 *     opens a pending diff review;
 *   - otherwise a dirty working tree still creates a review as before;
 *   - a clean working tree carries no create input, so it opens the latest
 *     pending diff review instead of erroring.
 */
async function diffCommand(argv: string[]): Promise<number> {
  const parsed = parseArgs(argv);
  const selector = openSelector(parsed);
  const wantsOpen = selector !== undefined || "open" in parsed.flags || "latest" in parsed.flags;
  if (wantsOpen) return openReviewOfKind(isDiffReview, "diff", selector);

  const workspace = await resolveWorkspace();
  const diff = await workingTreeDiff();
  if (!diff.patch.trim()) {
    return openReviewOfKind(
      isDiffReview,
      "diff",
      undefined,
      "working tree is clean and no pending diff review - nothing to open",
    );
  }
  const client = await DaemonClient.connect({ autostart: true });
  const review = await openReview(client, {
    type: "diff",
    content: diff.patch,
    files: diff.files,
    workspace,
    title: `working tree @ ${workspace.branch}`,
  });
  client.close();
  return runTui(review.id);
}

/**
 * `cueloop review` disambiguates create from open by intent:
 *   - bare `cueloop review`, `--open`/`--latest`, or a `ses_*` selector opens a
 *     pending PR review (a diff carrying a `pr` reference);
 *   - any other positional is a PR reference and takes the create path in pr.ts.
 */
async function reviewEntry(argv: string[]): Promise<number> {
  const parsed = parseArgs(argv);
  const explicitOpen = "open" in parsed.flags || "latest" in parsed.flags;
  const selector = openSelector(parsed);
  const looksLikeSessionId = selector !== undefined && isSessionId(selector);
  const wantsCreate = !explicitOpen && !looksLikeSessionId && selector !== undefined;
  if (wantsCreate) {
    const { reviewCommand } = await import("./pr");
    return reviewCommand(argv);
  }
  return openReviewOfKind(
    isPrReview,
    "PR",
    explicitOpen || looksLikeSessionId ? selector : undefined,
  );
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
      "usage: cueloop [command] [options]",
      "",
      "common commands:",
      "  cueloop                          open the inbox",
      "  cueloop plan [id|title]          open the latest pending plan review (or one by id/title)",
      "  cueloop diff [id|title]          review your working tree (untracked files included);",
      "                                   with a clean tree, open the latest pending diff review",
      "  cueloop review <pr>              review a pull request (--no-tui prints the session)",
      "  cueloop prototype <file.html>    review a rendered HTML prototype (or open the latest by id/title)",
      "",
      "share:",
      "  cueloop serve [session-id]       share over ssh: observers are read-only,",
      "                                   you stay the controller (--port 2222, --host 127.0.0.1;",
      "                                   password-less - share the address deliberately)",
      "  cueloop share [session-id]       hand a plan to a teammate: copies one",
      "                                   ssh line (--host cueloop.dev, --port 22)",
      "  cueloop share pull [session-id]  pull a teammate's annotations back into the plan",
      "",
      "open a specific review:",
      "  cueloop <session-id>             open one session",
      "  cueloop review [id|title]        open the latest pending PR review (or one by id/title)",
      "  cueloop <plan|diff|review> --latest  open the latest pending review of that type",
      "",
      "scripting:",
      "  cueloop session <verb> [flags]   script the daemon (create|get|list|wait|annotate|resolve|submit-revision)",
      "  cueloop actions list             list the quick-action vocabulary (for annotate --action)",
      "  cueloop wake <id> [--harness codex --thread <id>]  resume the agent with the verdict (spawn detached)",
      "  cueloop review-post <id> <pr>    post a resolved session's verdict back to the PR",
      "  cueloop daemon                   run the daemon in the foreground",
      "",
      "  cueloop -v, --version            print the installed version",
      "  cueloop -h, --help               print this help",
    ].join("\n"),
  );
}

process.exit(await main());
