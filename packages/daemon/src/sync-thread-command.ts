import * as v from "valibot";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Annotation, Thread } from "@cueloop/schema";
import { DaemonCore, type DaemonEvent } from "./api";
import { MemoryThreadStore } from "./store";
import { DaemonError } from "./errors";
import { parseParams, ThreadRecordSchema, type MethodName } from "./validate";
import type { SyncThreadCommandName, SyncThreadCommandParameters } from "./sync-thread-protocol";

export interface SyncThreadPrincipal {
  actorIdentifier: string;
  role: "viewer" | "editor" | "owner";
}

interface SyncThreadCommandHandler {
  audience: "editor" | "owner";
  apply: (
    core: DaemonCore,
    parameters: SyncThreadCommandParameters,
    principal: SyncThreadPrincipal,
  ) => Thread | null;
}

function defineSyncThreadCommand<Method extends MethodName>(
  method: Method,
  audience: "editor" | "owner",
  apply: (
    core: DaemonCore,
    parameters: ReturnType<typeof parseParams<Method>>,
    principal: SyncThreadPrincipal,
  ) => Thread | null,
) {
  return {
    audience,
    apply: (
      core: DaemonCore,
      parameters: SyncThreadCommandParameters,
      principal: SyncThreadPrincipal,
    ) => apply(core, parseParams(method, parameters), principal),
  };
}

function annotateSyncThread(
  core: DaemonCore,
  parameters: { id: string; annotation: Omit<Annotation, "createdAt">; authorName?: string },
  principal: SyncThreadPrincipal,
): Thread {
  const thread = core.sessionGet(parameters.id);
  const existing = [...thread.annotations, ...(thread.shelvedAnnotations ?? [])].find(
    (annotation) => annotation.id === parameters.annotation.id,
  );

  if (existing && principal.role !== "owner" && existing.author !== principal.actorIdentifier)
    throw new DaemonError("forbidden", "Sync Thread comment belongs to another participant");

  return core.sessionAnnotate(
    parameters.id,
    { ...parameters.annotation, author: existing ? existing.author : principal.actorIdentifier },
    parameters.authorName,
  );
}

const syncThreadCommands = {
  "session.applyDiffCapture": defineSyncThreadCommand(
    "session.applyDiffCapture",
    "owner",
    (core, parameters) =>
      core.sessionApplyDiffCapture(
        parameters.id,
        v.parse(ThreadRecordSchema, JSON.parse(parameters.snapshot)),
      ),
  ),
  "session.annotate": defineSyncThreadCommand("session.annotate", "editor", annotateSyncThread),
  "session.comment": defineSyncThreadCommand("session.comment", "editor", annotateSyncThread),
  "session.removeAnnotation": defineSyncThreadCommand(
    "session.removeAnnotation",
    "editor",
    (core, parameters, principal) =>
      core.sessionRemoveAnnotation(
        parameters.id,
        parameters.annotationId,
        principal.role === "owner" ? undefined : principal.actorIdentifier,
      ),
  ),
  "session.setParticipantName": defineSyncThreadCommand(
    "session.setParticipantName",
    "editor",
    (core, parameters, principal) => {
      if (principal.role !== "owner" && parameters.author !== principal.actorIdentifier)
        throw new DaemonError("forbidden", "Sync Thread participant name belongs to another actor");

      return core.sessionSetParticipantName(parameters.id, parameters.author, parameters.name);
    },
  ),
  "session.setWorkingCopy": defineSyncThreadCommand(
    "session.setWorkingCopy",
    "editor",
    (core, parameters) =>
      core.sessionSetWorkingCopy(parameters.id, parameters.workingCopy, parameters.textCuts),
  ),
  "session.cutBlock": defineSyncThreadCommand("session.cutBlock", "editor", (core, parameters) =>
    core.sessionCutBlock(parameters.id, parameters.blockIndex),
  ),
  "session.restoreBlock": defineSyncThreadCommand(
    "session.restoreBlock",
    "editor",
    (core, parameters) =>
      core.sessionRestoreBlock(parameters.id, parameters.baseBlockIndex, parameters.line),
  ),
  "session.curate": defineSyncThreadCommand("session.curate", "editor", (core, parameters) =>
    core.sessionCurate(parameters.id, parameters.rejections),
  ),
  "session.setViewed": defineSyncThreadCommand("session.setViewed", "owner", (core, parameters) =>
    core.sessionSetViewed(parameters.id, parameters.viewedPaths),
  ),
  "session.setTitle": defineSyncThreadCommand("session.setTitle", "editor", (core, parameters) =>
    core.sessionSetTitle(parameters.id, parameters.title),
  ),
  "session.navigate": defineSyncThreadCommand("session.navigate", "owner", (core, parameters) =>
    core.sessionNavigate(parameters.id, parameters.entryId, parameters.summary, parameters.branch),
  ),
  "session.branch": defineSyncThreadCommand("session.branch", "owner", (core, parameters) =>
    core.sessionBranch(parameters.id, parameters.name),
  ),
  "session.switch": defineSyncThreadCommand("session.switch", "owner", (core, parameters) =>
    core.sessionSwitch(parameters.id, parameters.branch),
  ),
  "session.label": defineSyncThreadCommand("session.label", "owner", (core, parameters) =>
    core.sessionLabel(parameters.id, parameters.label),
  ),
  "session.fork": defineSyncThreadCommand("session.fork", "owner", (core, parameters) =>
    core.sessionFork(parameters.id),
  ),
  "session.setShares": defineSyncThreadCommand("session.setShares", "owner", (core, parameters) =>
    core.sessionSetShares(parameters.id, parameters.shares),
  ),
  "session.delete": defineSyncThreadCommand("session.delete", "owner", (core, parameters) => {
    core.sessionDelete(parameters.id);

    return null;
  }),
  "session.mergeShared": defineSyncThreadCommand(
    "session.mergeShared",
    "owner",
    (core, parameters) => core.sessionMergeShared(parameters.id, parameters),
  ),
  "session.sendMessage": defineSyncThreadCommand(
    "session.sendMessage",
    "owner",
    (core, parameters) =>
      core.sessionSendMessage(
        parameters.id,
        parameters.outcome,
        parameters.summary,
        parameters.actionBodies,
        parameters.operationId,
      ),
  ),
  "session.submitRevision": defineSyncThreadCommand(
    "session.submitRevision",
    "owner",
    (core, parameters) =>
      core.sessionSubmitRevision(
        parameters.id,
        parameters.content,
        parameters.addressedAnnotationIds,
        parameters.files,
        parameters.source,
      ),
  ),
} satisfies Record<SyncThreadCommandName, SyncThreadCommandHandler>;

export function assertSyncThreadCommandAccess(
  principal: SyncThreadPrincipal,
  method: SyncThreadCommandName,
): void {
  if (!Object.hasOwn(syncThreadCommands, method))
    throw new DaemonError("unknown_method", "Sync Thread command is not registered");

  if (
    principal.role === "viewer" ||
    (syncThreadCommands[method].audience === "owner" && principal.role !== "owner")
  )
    throw new DaemonError("forbidden", "Sync Thread command is not permitted for this actor");
}

/** The caller commits returned state before publishing events or releasing owner-side deliveries. */
export function applySyncThreadCommand(options: {
  thread: Thread;
  method: SyncThreadCommandName;
  parameters: SyncThreadCommandParameters;
  principal: SyncThreadPrincipal;
}) {
  assertSyncThreadCommandAccess(options.principal, options.method);
  const command = syncThreadCommands[options.method];

  if (options.parameters.id !== options.thread.id)
    throw new DaemonError("forbidden", "Sync Thread command targets a different Thread");

  const core = new DaemonCore(
    join(tmpdir(), `cueloop-thread-transaction-${randomUUID()}`),
    new MemoryThreadStore([options.thread]),
  );
  const events: DaemonEvent[] = [];

  core.onEvent((event) => events.push(event));

  try {
    const resultThread = command.apply(core, options.parameters, options.principal);
    const threads = core.store.list();
    const previousEntries = new Set(options.thread.history?.entries.map((entry) => entry.id));

    for (const thread of threads) {
      for (const entry of thread.history?.entries ?? []) {
        if (entry.type === "revision" && !previousEntries.has(entry.id))
          entry.author = options.principal.actorIdentifier;
      }
    }

    return { resultThread, threads, events };
  } finally {
    core.dispose();
  }
}
