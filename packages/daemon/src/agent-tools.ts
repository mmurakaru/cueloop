import * as v from "valibot";
import { resolve } from "node:path";
import { MESSAGE_OUTCOMES, type Thread } from "@cueloop/schema";
import type { MethodName } from "./validate";

/** Tool arguments are validated before entering the owner's daemon API. */
export function parseAgentToolInput(name: string, serialized: string) {
  const input: unknown = JSON.parse(serialized);

  if (name === "reply_to_comment") {
    const args = v.parse(
      v.object({
        id: v.string(),
        commentId: v.string(),
        body: v.pipe(v.string(), v.minLength(1), v.maxLength(32768)),
      }),
      input,
    );

    return { kind: "reply" as const, ...args };
  }

  if (name === "send_message") {
    const args = v.parse(
      v.object({
        id: v.string(),
        outcome: v.picklist(MESSAGE_OUTCOMES),
        summary: v.optional(v.string(), ""),
      }),
      input,
    );

    return { kind: "api" as const, method: "session.sendMessage", params: args };
  }

  if (name !== "cueloop_api") throw new Error("Thread agent tool name is unavailable");

  const args = v.parse(v.object({ method: v.string(), params: v.unknown() }), input);

  return { kind: "api" as const, ...args };
}

const THREAD_AGENT_SESSION_METHODS = new Set<string>([
  "session.get",
  "session.wait",
  "session.annotate",
  "session.comment",
  "session.removeAnnotation",
  "session.setParticipantName",
  "session.setWorkingCopy",
  "session.cutBlock",
  "session.navigate",
  "session.branch",
  "session.switch",
  "session.label",
  "session.restoreBlock",
  "session.curate",
  "session.setViewed",
  "session.setTitle",
  "session.projectFiles",
  "session.fileContents",
  "session.refreshDiff",
  "session.sendMessage",
  "session.submitRevision",
] satisfies MethodName[]);
const THREAD_AGENT_REPO_METHODS = new Set<string>([
  "repo.files",
  "repo.fileContents",
  "repo.changes",
  "repo.diff",
] satisfies MethodName[]);

/** Harness tools are bound to their originating Thread; model arguments cannot widen that scope. */
export function assertAgentToolScope(
  thread: Thread,
  input: ReturnType<typeof parseAgentToolInput>,
): void {
  if (input.kind === "reply") {
    if (input.id !== thread.id) throw new Error("Thread agent tool cannot access another Thread");

    return;
  }

  if (input.method === "session.list") return;

  const params = v.parse(v.record(v.string(), v.unknown()), input.params);

  if (THREAD_AGENT_SESSION_METHODS.has(input.method)) {
    if (params.id !== thread.id) throw new Error("Thread agent tool cannot access another Thread");

    return;
  }

  if (THREAD_AGENT_REPO_METHODS.has(input.method)) {
    const { cwd } = v.parse(v.object({ cwd: v.string() }), params);

    if (resolve(cwd) !== resolve(thread.workspace.repoRoot))
      throw new Error("Thread agent tool cannot access another repository");

    return;
  }

  throw new Error("Thread agent tool API method is unavailable");
}
