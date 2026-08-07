/**
 * `cueloop session *` - mirrors the daemon socket API 1:1 (#14). One surface,
 * three consumers: agent adapters, the dev loop, and integrations. Output is
 * JSON on stdout; exit code 0 unless the daemon returned an error.
 */

import type { ArtifactType, VerdictKind } from "@cueloop/schema";
import { DaemonClient } from "@cueloop/daemon/client";
import { parseArgs, flagStr } from "./args";
import { resolveWorkspace } from "./workspace";

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
        const workspace = await resolveWorkspace(flagStr(flags, "cwd"));
        const contentFile = flagStr(flags, "content-file");
        const content = contentFile ? await Bun.file(contentFile).text() : await readStdin();
        const session = await client.sessionCreate(workspace, {
          type: (flagStr(flags, "type") ?? "plan") as ArtifactType,
          content,
          meta: {
            agent: flagStr(flags, "agent"),
            agentSessionId: flagStr(flags, "agent-session-id"),
            planPath: flagStr(flags, "plan-path"),
            title: flagStr(flags, "title"),
            cwd: flagStr(flags, "cwd") ?? process.cwd(),
          },
        });
        out(session);
        return 0;
      }
      case "get": {
        out(await client.sessionGet(required(positional[1], "session id")));
        return 0;
      }
      case "list": {
        const status = flagStr(flags, "status") as "pending" | "resolved" | undefined;
        out(await client.sessionList(status ? { status } : undefined));
        return 0;
      }
      case "wait": {
        const id = required(positional[1], "session id");
        const timeoutMs = Number(flagStr(flags, "timeout-ms") ?? "60000");
        const session = await client.sessionWait(id, timeoutMs);
        if (session === null) {
          out({ status: "pending" });
          return 0;
        }
        out({
          status: "resolved",
          allow: session.verdict!.kind === "approve",
          verdict: session.verdict!.kind,
          feedback: session.verdict!.feedback,
        });
        return 0;
      }
      case "annotate": {
        const id = required(positional[1], "session id");
        const body = flagStr(flags, "body") ?? "";
        const quote = required(flagStr(flags, "quote"), "--quote");
        out(
          await client.sessionAnnotate(id, {
            id: flagStr(flags, "annotation-id") ?? `a_${Date.now().toString(36)}`,
            kind: flagStr(flags, "kind") ?? "comment",
            anchor: {
              quote,
              prefix: flagStr(flags, "prefix") ?? "",
              suffix: flagStr(flags, "suffix") ?? "",
            },
            body,
          }),
        );
        return 0;
      }
      case "resolve": {
        const id = required(positional[1], "session id");
        const kind = required(flagStr(flags, "verdict"), "--verdict") as VerdictKind;
        out(await client.sessionResolve(id, kind, flagStr(flags, "summary") ?? ""));
        return 0;
      }
      case "submit-revision": {
        const id = required(positional[1], "session id");
        const contentFile = flagStr(flags, "content-file");
        const content = contentFile ? await Bun.file(contentFile).text() : await readStdin();
        out(await client.sessionSubmitRevision(id, content));
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

function required<T>(v: T | undefined, what: string): T {
  if (v === undefined) throw new Error(`missing ${what}`);
  return v;
}
