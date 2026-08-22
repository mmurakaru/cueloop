/**
 * `cueloop session *` - mirrors the daemon socket API 1:1. One surface,
 * three consumers: agent adapters, the dev loop, and integrations. Output is
 * JSON on stdout; exit code 0 unless the daemon returned an error.
 */

import { newAnnotationId, type ArtifactType, type VerdictKind } from "@cueloop/schema";
import { DaemonClient } from "@cueloop/daemon/client";
import { openHerdrPaneForReview } from "@cueloop/daemon/herdr-pane";
import { openReview, verdictResponse, type ReviewNote } from "@cueloop/daemon/review";
import { loadConfig, quickActionBody, resolveQuickAction } from "@cueloop/client/config";
import { parseArgs, stringFlag } from "./args";

async function readStdin(): Promise<string> {
  return await new Response(Bun.stdin.stream()).text();
}

function out(value: unknown): void {
  console.log(JSON.stringify(value, null, 2));
}

export async function sessionCommand(argv: string[]): Promise<number> {
  const { positional, flags } = parseArgs(argv);
  const verb = positional[0];
  const client = await DaemonClient.connect({ autostart: true });
  try {
    switch (verb) {
      case "create": {
        const contentFile = stringFlag(flags, "content-file");
        const content = contentFile ? await Bun.file(contentFile).text() : await readStdin();
        // per-file agent notes for diff sessions: a JSON array of { path, body }
        const notesFile = stringFlag(flags, "notes-file");
        const notes = notesFile
          ? (JSON.parse(await Bun.file(notesFile).text()) as ReviewNote[])
          : undefined;
        const review = await openReview(client, {
          type: (stringFlag(flags, "type") ?? "plan") as ArtifactType,
          content,
          cwd: stringFlag(flags, "cwd"),
          agent: stringFlag(flags, "agent"),
          agentSessionId: stringFlag(flags, "agent-session-id"),
          planPath: stringFlag(flags, "plan-path"),
          title: stringFlag(flags, "title"),
          notes,
        });
        // herdr auto-open: render the review in a tab (no-op outside herdr).
        await openHerdrPaneForReview(review.session, client);
        out(review.session);
        return 0;
      }
      case "get": {
        out(await client.sessionGet(required(positional[1], "session id")));
        return 0;
      }
      case "list": {
        const status = stringFlag(flags, "status") as "pending" | "resolved" | undefined;
        out(await client.sessionList(status ? { status } : undefined));
        return 0;
      }
      case "wait": {
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
      case "annotate": {
        const id = required(positional[1], "session id");
        const quote = required(stringFlag(flags, "quote"), "--quote");
        const author = stringFlag(flags, "author");
        const body = annotateBody(flags);
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
              ...(author ? { author } : {}),
            },
            stringFlag(flags, "author-name"),
          ),
        );
        return 0;
      }
      case "resolve": {
        const id = required(positional[1], "session id");
        const kind = required(stringFlag(flags, "verdict"), "--verdict") as VerdictKind;
        out(await client.sessionResolve(id, kind, stringFlag(flags, "summary") ?? ""));
        return 0;
      }
      case "submit-revision": {
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
      default:
        console.error(
          "usage: cueloop session <create|get|list|wait|annotate|resolve|submit-revision> [flags]",
        );
        return 2;
    }
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
 * quick-action expanded through the shared vocabulary, else empty.
 */
function annotateBody(flags: Record<string, string | boolean>): string {
  const explicit = stringFlag(flags, "body");
  if (explicit !== undefined) return explicit;
  const actionRef = stringFlag(flags, "action");
  if (actionRef === undefined) return "";
  const actions = loadConfig({ repoRoot: process.cwd() }).actions;
  const action = resolveQuickAction(actions, actionRef);
  if (!action) throw new Error(`no quick action ${actionRef} - see: cueloop actions list`);
  return quickActionBody(action);
}
