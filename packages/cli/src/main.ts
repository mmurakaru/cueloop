#!/usr/bin/env bun
/**
 * cueloop entry points: `cueloop` opens the TUI on the inbox, the primitive-first
 * openers `cueloop plan|reply|diff|review` open the latest pending review of
 * that type (or address one by id/title), `cueloop diff`/`cueloop review <pr>` also
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
  isReplyReview,
  isSessionId,
  openTargetMessage,
  resolveOpenTarget,
} from "./open-target";
import { sessionCommand } from "./thread-commands";
import { CLI_VERSION } from "./version";
import { DaemonClient } from "@cueloop/daemon/client";
import type { Thread } from "@cueloop/schema";
import { openReview } from "@cueloop/daemon/thread-review";

const argv = process.argv.slice(2);
const cmd = argv[0];

async function daemonCommand(argv: string[]): Promise<number> {
  const { DaemonServer } = await import("@cueloop/daemon");
  // Explicit foreground never idle-exits; --autostart (a re-exec from the client)
  // takes the normal idle-exit, matching the source main.ts entry.
  const envIdle = process.env.CUELOOP_IDLE_EXIT_MS;
  let idleExitMs: number | undefined = 0;

  if (argv.includes("--autostart")) idleExitMs = envIdle ? Number(envIdle) : undefined;
  const server = new DaemonServer({ idleExitMs });
  const path = server.start();

  if (path === null) {
    console.error("a cueloop daemon already owns this home - nothing to do");

    return 1;
  }
  console.log(`cueloop daemon (foreground) on ${path}`);
  await new Promise(() => {}); // run until signalled

  return 0;
}

async function serveEntry(rest: string[]): Promise<number> {
  const { positional, flags } = parseArgs(rest);
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

async function shareEntry(rest: string[]): Promise<number> {
  const { positional, flags } = parseArgs(rest);
  const { shareCommand, sharePullCommand } = await import("./share-command");
  const port = stringFlag(flags, "port");
  const target = {
    host: stringFlag(flags, "host"),
    port: port !== undefined ? Number(port) : undefined,
  };

  if (positional[0] === "pull") return sharePullCommand({ ...target, sessionId: positional[1] });

  return shareCommand({ ...target, sessionId: positional[0], fork: flags.fork === true });
}

type CommandHandler = (rest: string[]) => number | Promise<number>;

interface CommandHandlers {
  [command: string]: CommandHandler;
}

const commandHandlers: CommandHandlers = {
  session: (rest) => sessionCommand(rest),
  daemon: (rest) => daemonCommand(rest),
  stop: async () => (await import("./daemon-control")).stopCommand(),
  restart: async () => (await import("./daemon-control")).restartCommand(),
  plan: (rest) => planCommand(rest),
  reply: (rest) => replyCommand(rest),
  diff: (rest) => diffCommand(rest),
  prototype: (rest) => prototypeCommand(rest),
  serve: (rest) => serveEntry(rest),
  share: (rest) => shareEntry(rest),
  harness: async () => (await import("./harness-command")).harnessCommand(),
  "codex-hook": async () => (await import("./codex-hook-command")).codexHookCommand(),
  "codex-delivery-worker": async () =>
    (await import("./codex-delivery-worker-command")).codexDeliveryWorkerCommand(),
  mcp: async () => (await import("./codex-mcp-command")).codexMcpCommand(),
  actions: async (rest) => (await import("./actions-command")).actionsCommand(rest),
  refine: async (rest) => (await import("./refine-command")).refineCommand(rest),
  update: async (rest) => (await import("./update-command")).updateCommand(rest),
  install: async (rest) => (await import("./install-command")).installExtensionCommand(rest),
  review: (rest) => reviewEntry(rest),
  "review-config": async () => (await import("./pr")).reviewConfigCommand(),
  "review-comment": async (rest) => (await import("./pr")).reviewCommentCommand(rest),
  "review-open": async (rest) => (await import("./pr")).reviewOpenCommand(rest),
  "review-post": async (rest) => (await import("./pr")).reviewPostCommand(rest),
  dev: async () => (await import("./dev-command")).devCommand(),
};

const versionAliases = new Set(["-v", "--version", "version"]);
const helpAliases = new Set(["-h", "--help", "help"]);

async function main(): Promise<number> {
  if (cmd === undefined) return runTui();
  const handler = commandHandlers[cmd];

  if (handler !== undefined) return handler(argv.slice(1));
  if (versionAliases.has(cmd)) {
    console.log(CLI_VERSION);

    return 0;
  }
  if (helpAliases.has(cmd)) {
    printHelp();

    return 0;
  }
  if (cmd.startsWith("ses_")) return runTui(cmd);
  printHelp();

  return 2;
}

/**
 * The id-or-title selector for a primitive-first opener: the bare positional, or a
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
 * Resolve one review of the primitive's scope and open it in the TUI, or print the
 * miss and fail. `emptyMessage` overrides the default no-pending line for the
 * one caller that needs a scope-specific hint (a clean working tree).
 */
async function openReviewOfKind(
  match: (session: Thread) => boolean,
  label: string,
  selector: string | undefined,
  layout: "review" | "plan" | undefined,
  emptyMessage?: string,
): Promise<number> {
  const client = await DaemonClient.connect({ autostart: true });
  let sessions: Thread[];

  try {
    sessions = await client.sessionList();
  } finally {
    client.close();
  }
  const target = resolveOpenTarget(sessions, { match, selector });

  if (target.kind === "session") return runTui(target.sessionId, layout);
  if (target.kind === "no-pending" && emptyMessage !== undefined) {
    console.error(emptyMessage);

    return 1;
  }
  console.error(openTargetMessage(label, target));

  return 1;
}

/** `cueloop plan [id|title]` - open the latest pending plan, or address one. */
async function planCommand(argv: string[]): Promise<number> {
  return openReviewOfKind(isPlanReview, "plan", openSelector(parseArgs(argv)), "plan");
}

/**
 * `cueloop reply [id|title]` - open the latest pending reply review, or address
 * one. A reply artifact is the agent's previous message, submitted for review
 * by the /cueloop:reply skill; the opener is scope-only, like plan.
 */
async function replyCommand(argv: string[]): Promise<number> {
  return openReviewOfKind(isReplyReview, "reply", openSelector(parseArgs(argv)), "plan");
}

/**
 * `cueloop prototype <file.md>` creates a review of a component design doc
 * (API / Composition / Callstack); an `.html` file instead creates the opt-in
 * experimental pixel mockup. A selector or `--open`/`--latest` (or a bare call
 * with no file) opens the latest pending prototype review instead.
 */
async function prototypeCommand(argv: string[]): Promise<number> {
  const parsed = parseArgs(argv);
  const selector = openSelector(parsed);
  const wantsOpen = "open" in parsed.flags || "latest" in parsed.flags;
  // a markdown design doc is the default; an .html entry is the opt-in pixel mockup
  const isHtmlPrototype = selector?.endsWith(".html") ?? false;
  const isMarkdownPrototype = selector?.endsWith(".md") || selector?.endsWith(".markdown") || false;
  const looksLikeFile =
    selector !== undefined && !isSessionId(selector) && (isHtmlPrototype || isMarkdownPrototype);

  if (wantsOpen || !looksLikeFile)
    return openReviewOfKind(isPrototypeReview, "prototype", selector, "plan");

  const path = resolve(selector);
  const content = await Bun.file(path)
    .text()
    .catch(() => undefined);

  if (content === undefined) {
    console.error(`prototype: cannot read ${path}`);

    return 1;
  }
  const client = await DaemonClient.connect({ autostart: true });
  const review = await openReview(client, {
    type: "prototype",
    content,
    // only an HTML entry carries a prototypePath, the signal for the experimental pixel mode
    prototypePath: isHtmlPrototype ? path : undefined,
    title: basename(path),
  });

  client.close();

  return runTui(review.id, "plan");
}

/**
 * `cueloop diff` opens the repo's workbench in the review layout:
 *   - a selector (`cueloop diff <id|title>`) or an explicit `--open`/`--latest`
 *     opens a specific pending diff thread;
 *   - a bare `cueloop diff` find-or-creates the per-repo workbench thread - a live-diff
 *     annotation container - so it is immediately annotatable and always shows the
 *     current working tree, reusing the same thread across re-runs.
 */
async function diffCommand(argv: string[]): Promise<number> {
  const parsed = parseArgs(argv);
  const selector = openSelector(parsed);
  const wantsOpen = selector !== undefined || "open" in parsed.flags || "latest" in parsed.flags;

  if (wantsOpen) return openReviewOfKind(isDiffReview, "diff", selector, "review");

  const client = await DaemonClient.connect({ autostart: true });
  const workbench = await client.sessionWorkbench(process.cwd());

  client.close();

  return runTui(workbench.id, "review");
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
    "review",
  );
}

/**
 * A create-command dictates the pane composition it opens in; a bare launch (`layout`
 * omitted) restores the remembered one. Resolve the factory here so the heavy client
 * module stays lazily imported for non-TUI commands.
 */
async function runTui(sessionId?: string, layout?: "review" | "plan"): Promise<number> {
  const { runClient, reviewLayout, planLayout } = await import("@cueloop/client");
  const resolved =
    layout === "review" ? reviewLayout() : layout === "plan" ? planLayout() : undefined;

  return runClient({ sessionId, layout: resolved });
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
      "  cueloop reply [id|title]         open the latest pending reply review (the agent's previous message)",
      "  cueloop diff [id|title]          review your working tree (untracked files included);",
      "                                   with a clean tree, open the latest pending diff review",
      "  cueloop review <pr>              review a pull request (--no-tui prints the session)",
      "  cueloop prototype <file.md>      review a component design doc (or open the latest by id/title)",
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
      "  cueloop session <primitive> [flags]   script the daemon (create|get|list|wait|annotate|remove|cut|restore|curate|set-viewed|navigate|branch|switch|label|fork|name-self|events|send-message|bind-harness|pending-deliveries|acknowledge-delivery|submit-revision)",
      "  cueloop actions list             list the quick-action vocabulary (for annotate --action)",
      "  cueloop refine                   mine past reviews into a markdown report + writeback proposals",
      "  cueloop update [--dry-run]       update the installed cueloop binary (--dry-run reports the target only)",
      "  cueloop install npm:<package>    install a user-level extension package",
      "  cueloop review-post <id>         explicitly post selected agent findings to the PR",
      "  cueloop review-comment <id>      add or update an agent PR finding (see --help)",
      "  cueloop daemon                   run the daemon in the foreground",
      "  cueloop stop                     stop the local daemon",
      "  cueloop restart                  stop the local daemon and start a fresh one",
      "  cueloop dev                      open the TUI on an isolated home seeded with example threads",
      "",
      "  cueloop -v, --version            print the installed version",
      "  cueloop -h, --help               print this help",
    ].join("\n"),
  );
}

process.exit(await main());
