/**
 * `cueloop session *` - mirrors the daemon socket API 1:1. One surface,
 * three consumers: agent adapters, the dev loop, and integrations. Output is
 * JSON on stdout; exit code 0 unless the daemon returned an error.
 */

import {
  ARTIFACT_TYPES,
  isArtifactType,
  newAnnotationId,
  type Anchor,
  type Annotation,
} from "@cueloop/schema";
import * as v from "valibot";
import { DaemonClient } from "@cueloop/daemon/client";
import { openHerdrPaneForReview } from "@cueloop/daemon/herdr-pane";
import { openReview, verdictResponse } from "@cueloop/daemon/review";
import { loadConfig, quickActionBody, resolveQuickAction } from "@cueloop/client/config";
import { parseArgs, stringFlag } from "./args";

async function readStdin(): Promise<string> {
  return await new Response(Bun.stdin.stream()).text();
}

function out(value: Parameters<typeof JSON.stringify>[0]): void {
  console.log(JSON.stringify(value, null, 2));
}

const ReviewNotesSchema = v.array(v.object({ path: v.string(), body: v.string() }));
const SessionStatusSchema = v.picklist(["pending", "resolved"]);
const VerdictKindSchema = v.picklist(["comment", "approve", "request_changes"]);

type SessionFlags = Record<string, string | boolean>;
type SessionContext = { client: DaemonClient; positional: string[]; flags: SessionFlags };
type SessionVerbHandler = (context: SessionContext) => Promise<number>;

async function sessionCreate({ client, flags }: SessionContext): Promise<number> {
  const type = stringFlag(flags, "type") ?? "plan";

  if (!isArtifactType(type)) {
    console.error(`unknown artifact type "${type}" - one of: ${ARTIFACT_TYPES.join(", ")}`);
    return 2;
  }
  const contentFile = stringFlag(flags, "content-file");
  const content = contentFile ? await Bun.file(contentFile).text() : await readStdin();
  // per-file agent notes for diff sessions: a JSON array of { path, body }
  const notesFile = stringFlag(flags, "notes-file");
  const notes = notesFile
    ? v.parse(ReviewNotesSchema, JSON.parse(await Bun.file(notesFile).text()))
    : undefined;
  const review = await openReview(client, {
    type,
    content,
    cwd: stringFlag(flags, "cwd"),
    agent: stringFlag(flags, "agent"),
    agentSessionId: stringFlag(flags, "agent-session-id"),
    planPath: stringFlag(flags, "plan-path"),
    prototypePath: stringFlag(flags, "prototype-path"),
    title: stringFlag(flags, "title"),
    notes,
  });

  // herdr auto-open: render the review in a tab (no-op outside herdr).
  await openHerdrPaneForReview(review.session, client);
  out(review.session);

  return 0;
}

async function sessionGetCommand({ client, positional }: SessionContext): Promise<number> {
  out(await client.sessionGet(required(positional[1], "session id")));

  return 0;
}

async function sessionListCommand({ client, flags }: SessionContext): Promise<number> {
  const rawStatus = stringFlag(flags, "status");
  const status = rawStatus ? v.parse(SessionStatusSchema, rawStatus) : undefined;

  out(await client.sessionList(status ? { status } : undefined));

  return 0;
}

async function sessionWaitCommand({ client, positional, flags }: SessionContext): Promise<number> {
  const id = required(positional[1], "session id");
  const timeoutMs = Number(stringFlag(flags, "timeout-ms") ?? "60000");
  const session = await client.sessionWait(id, timeoutMs);

  if (session === null) {
    out({ status: "pending" });

    return 0;
  }
  const { allow, feedback } = verdictResponse(session);

  out({ status: "resolved", allow, verdict: session.verdict!.kind, feedback });

  return 0;
}

/**
 * The anchor an annotate call means: a reply borrows its root comment's
 * anchor, a prototype comment names an element by selector, and anything
 * else quotes the passage.
 */
async function annotateAnchor(
  flags: Record<string, string | boolean>,
  client: DaemonClient,
  id: string,
): Promise<{ anchor: Anchor; replyTo?: string }> {
  const replyTo = stringFlag(flags, "reply-to");

  if (replyTo !== undefined) {
    const session = await client.sessionGet(id);
    const root = session.annotations.find((annotation) => annotation.id === replyTo);

    if (!root) throw new Error(`no comment ${replyTo} to reply to`);

    // a reply to a reply still hangs off the discussion's root comment
    return { anchor: root.anchor, replyTo: root.replyTo ?? root.id };
  }
  const selector = stringFlag(flags, "selector");
  const quote =
    selector === undefined
      ? required(stringFlag(flags, "quote"), "--quote")
      : (stringFlag(flags, "quote") ?? "");
  const anchor: Anchor = {
    quote,
    prefix: stringFlag(flags, "prefix") ?? "",
    suffix: stringFlag(flags, "suffix") ?? "",
  };

  if (selector !== undefined) anchor.selector = selector;

  return { anchor };
}

async function sessionAnnotateCommand({
  client,
  positional,
  flags,
}: SessionContext): Promise<number> {
  const id = required(positional[1], "session id");
  const author = stringFlag(flags, "author");
  const body = await annotateBody(flags, client, id);
  const { anchor, replyTo } = await annotateAnchor(flags, client, id);
  const annotation: Omit<Annotation, "createdAt"> = {
    id: stringFlag(flags, "annotation-id") ?? newAnnotationId(),
    kind: stringFlag(flags, "kind") ?? "comment",
    anchor,
    body,
    author,
  };

  if (replyTo !== undefined) annotation.replyTo = replyTo;
  out(await client.sessionAnnotate(id, annotation, stringFlag(flags, "author-name")));

  return 0;
}

/** Remove a comment; a non-owner connection removes only the comments of the author it is bound to. */
async function sessionRemoveCommand({ client, positional }: SessionContext): Promise<number> {
  const id = required(positional[1], "session id");
  const annotationId = required(positional[2], "annotation id");

  out(await client.sessionRemoveAnnotation(id, annotationId));

  return 0;
}

/** A 0-based block or line index as the command line carries it. */
const BlockIndexSchema = v.pipe(v.string(), v.transform(Number), v.integer(), v.minValue(0));

/** The reject decisions of a diff review as `--rejections` carries them. */
const RejectionsSchema = v.array(
  v.object({
    path: v.pipe(v.string(), v.minLength(1)),
    hunkIndex: v.pipe(v.number(), v.integer(), v.minValue(0)),
    changeIndex: v.optional(v.pipe(v.number(), v.integer(), v.minValue(0))),
  }),
);

/** Cut the given block of the working copy (a 0-based index into its blocks). */
async function sessionCutCommand({ client, positional }: SessionContext): Promise<number> {
  const id = required(positional[1], "session id");
  const blockIndex = v.parse(BlockIndexSchema, required(positional[2], "block index"));

  out(await client.sessionCutBlock(id, blockIndex));

  return 0;
}

/** Re-insert a cut block of the submitted revision, before --line (default: the end). */
async function sessionRestoreCommand({
  client,
  positional,
  flags,
}: SessionContext): Promise<number> {
  const id = required(positional[1], "session id");
  const baseBlockIndex = v.parse(BlockIndexSchema, required(positional[2], "block index"));
  const line = stringFlag(flags, "line");

  out(
    await client.sessionRestoreBlock(
      id,
      baseBlockIndex,
      line === undefined ? undefined : v.parse(BlockIndexSchema, line),
    ),
  );

  return 0;
}

/** Replace a diff review's reject decisions with the JSON list given. */
async function sessionCurateCommand({
  client,
  positional,
  flags,
}: SessionContext): Promise<number> {
  const id = required(positional[1], "session id");
  const rejections = v.parse(
    RejectionsSchema,
    JSON.parse(required(stringFlag(flags, "rejections"), "--rejections")),
  );

  out(await client.sessionCurate(id, rejections));

  return 0;
}

/** Move a branch's tip back to an entry on its path; --summary records what was left behind, --branch stands on that branch first. */
async function sessionNavigateCommand({
  client,
  positional,
  flags,
}: SessionContext): Promise<number> {
  const id = required(positional[1], "session id");
  const entryId = required(positional[2], "entry id");

  out(
    await client.sessionNavigate(
      id,
      entryId,
      stringFlag(flags, "summary"),
      stringFlag(flags, "branch"),
    ),
  );

  return 0;
}

/** Start a branch at the current tip and switch to it. */
async function sessionBranchCommand({ client, positional }: SessionContext): Promise<number> {
  const id = required(positional[1], "session id");

  out(await client.sessionBranch(id, required(positional[2], "branch name")));

  return 0;
}

/** Show another branch's path. */
async function sessionSwitchCommand({ client, positional }: SessionContext): Promise<number> {
  const id = required(positional[1], "session id");

  out(await client.sessionSwitch(id, required(positional[2], "branch name")));

  return 0;
}

/** Name the current tip as a checkpoint. */
async function sessionLabelCommand({ client, positional }: SessionContext): Promise<number> {
  const id = required(positional[1], "session id");

  out(await client.sessionLabel(id, required(positional[2], "label")));

  return 0;
}

/** Copy the current path into a new session and print the fork. */
async function sessionForkCommand({ client, positional }: SessionContext): Promise<number> {
  out(await client.sessionFork(required(positional[1], "session id")));

  return 0;
}

/** Mark files of a diff review as viewed - the guided walk's state, from a script. */
async function sessionSetViewedCommand({ client, positional }: SessionContext): Promise<number> {
  const id = required(positional[1], "session id");

  out(await client.sessionSetViewed(id, positional.slice(2)));

  return 0;
}

/** Register the display name of a participant: how a collaborator or an agent names itself. */
async function sessionNameSelfCommand({
  client,
  positional,
  flags,
}: SessionContext): Promise<number> {
  const id = required(positional[1], "session id");
  const name = required(positional[2], "name");
  const author = required(stringFlag(flags, "author"), "--author");

  out(await client.sessionSetParticipantName(id, author, name));

  return 0;
}

/**
 * Follow a session live: one JSON line per event, with the entry the change
 * appended, until the process ends. `--once` prints the first event and exits.
 * The subscription is in place before the session is read, so nothing that
 * lands after the read can slip between the two.
 */
async function sessionEventsCommand({
  client,
  positional,
  flags,
}: SessionContext): Promise<number> {
  const id = required(positional[1], "session id");
  const once = flags.once === true;
  const stream = new Promise<number>((resolve) => {
    client.onEvent((event) => {
      if (event.sessionId !== id) return;
      out(event);
      if (once) resolve(0);
    });
  });

  await client.subscribe();
  await client.sessionGet(id);

  return stream;
}

async function sessionResolveCommand({
  client,
  positional,
  flags,
}: SessionContext): Promise<number> {
  const id = required(positional[1], "session id");
  const kind = v.parse(VerdictKindSchema, required(stringFlag(flags, "verdict"), "--verdict"));

  out(await client.sessionResolve(id, kind, stringFlag(flags, "summary") ?? ""));

  return 0;
}

async function sessionSubmitRevisionCommand({
  client,
  positional,
  flags,
}: SessionContext): Promise<number> {
  const id = required(positional[1], "session id");
  const contentFile = stringFlag(flags, "content-file");
  const content = contentFile ? await Bun.file(contentFile).text() : await readStdin();
  // --addressed a_1,a_2 - the annotation ids this revision acted on
  const addressed = (stringFlag(flags, "addressed") ?? "")
    .split(",")
    .map((annotationId) => annotationId.trim())
    .filter(Boolean);

  out(await client.sessionSubmitRevision(id, content, addressed));

  return 0;
}

interface SessionVerbHandlers {
  [primitive: string]: SessionVerbHandler;
}

const sessionVerbHandlers: SessionVerbHandlers = {
  create: sessionCreate,
  get: sessionGetCommand,
  list: sessionListCommand,
  wait: sessionWaitCommand,
  annotate: sessionAnnotateCommand,
  remove: sessionRemoveCommand,
  cut: sessionCutCommand,
  restore: sessionRestoreCommand,
  curate: sessionCurateCommand,
  "set-viewed": sessionSetViewedCommand,
  navigate: sessionNavigateCommand,
  branch: sessionBranchCommand,
  switch: sessionSwitchCommand,
  label: sessionLabelCommand,
  fork: sessionForkCommand,
  "name-self": sessionNameSelfCommand,
  events: sessionEventsCommand,
  resolve: sessionResolveCommand,
  "submit-revision": sessionSubmitRevisionCommand,
};

export async function sessionCommand(argv: string[]): Promise<number> {
  const { positional, flags } = parseArgs(argv);
  const primitive = positional[0];
  // --role agent (or collaborator) caps this connection to read + annotate; a
  // review-side agent passes it so the daemon rejects any escalation attempt.
  // and --author binds the identity its comments, removals, and name carry
  const role = stringFlag(flags, "role") === "agent" ? "agent" : undefined;
  const client = await DaemonClient.connect({
    autostart: true,
    role,
    author: role === undefined ? undefined : stringFlag(flags, "author"),
  });

  try {
    const handler = primitive !== undefined ? sessionVerbHandlers[primitive] : undefined;

    if (handler === undefined) {
      console.error(
        "usage: cueloop session <create|get|list|wait|annotate|remove|cut|restore|curate|set-viewed|navigate|branch|switch|label|fork|name-self|events|resolve|submit-revision> [flags]",
      );

      return 2;
    }

    return await handler({ client, positional, flags });
  } finally {
    client.close();
  }
}

function required<T>(value: T | undefined, description: string): T {
  if (value === undefined) throw new Error(`missing ${description}`);

  return value;
}

/**
 * The annotation body: an explicit `--body`, else the `--action <index|name>`
 * quick-action expanded through the shared vocabulary. The vocabulary is loaded
 * from the reviewed session's own repo, not the caller's cwd, so an agent
 * annotating from elsewhere still sees that session's actions.
 */
async function annotateBody(
  flags: Record<string, string | boolean>,
  client: DaemonClient,
  id: string,
): Promise<string> {
  const explicit = stringFlag(flags, "body");

  if (explicit !== undefined) return explicit;
  const actionRef = stringFlag(flags, "action");

  if (actionRef === undefined) return "";
  const session = await client.sessionGet(id);
  const actions = loadConfig({ repoRoot: session.workspace.repoRoot }).actions;
  const action = resolveQuickAction(actions, actionRef);

  if (!action) throw new Error(`no quick action ${actionRef} - see: cueloop actions list`);

  return quickActionBody(action);
}
