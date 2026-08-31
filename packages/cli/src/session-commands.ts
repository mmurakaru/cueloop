/**
 * `cueloop session *` - mirrors the daemon socket API 1:1. One surface,
 * three consumers: agent adapters, the dev loop, and integrations. Output is
 * JSON on stdout; exit code 0 unless the daemon returned an error.
 */

import { ARTIFACT_TYPES, isArtifactType, newAnnotationId } from "@cueloop/schema";
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

async function sessionAnnotateCommand({
  client,
  positional,
  flags,
}: SessionContext): Promise<number> {
  const id = required(positional[1], "session id");
  const quote = required(stringFlag(flags, "quote"), "--quote");
  const author = stringFlag(flags, "author");
  const body = await annotateBody(flags, client, id);

  out(
    await client.sessionAnnotate(
      id,
      {
        id: stringFlag(flags, "annotation-id") ?? newAnnotationId(),
        kind: stringFlag(flags, "kind") ?? "comment",
        anchor: {
          quote,
          prefix: stringFlag(flags, "prefix") ?? "",
          suffix: stringFlag(flags, "suffix") ?? "",
        },
        body,
        author,
      },
      stringFlag(flags, "author-name"),
    ),
  );

  return 0;
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
  [verb: string]: SessionVerbHandler;
}

const sessionVerbHandlers: SessionVerbHandlers = {
  create: sessionCreate,
  get: sessionGetCommand,
  list: sessionListCommand,
  wait: sessionWaitCommand,
  annotate: sessionAnnotateCommand,
  resolve: sessionResolveCommand,
  "submit-revision": sessionSubmitRevisionCommand,
};

export async function sessionCommand(argv: string[]): Promise<number> {
  const { positional, flags } = parseArgs(argv);
  const verb = positional[0];
  // --role agent (or collaborator) caps this connection to read + annotate; a
  // review-side agent passes it so the daemon rejects any escalation attempt.
  const role = stringFlag(flags, "role") === "agent" ? "agent" : undefined;
  const client = await DaemonClient.connect({ autostart: true, role });

  try {
    const handler = verb !== undefined ? sessionVerbHandlers[verb] : undefined;

    if (handler === undefined) {
      console.error(
        "usage: cueloop session <create|get|list|wait|annotate|resolve|submit-revision> [flags]",
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
