import * as v from "valibot";
import { parseHarnessEvent } from "./harness-event-validation";
import {
  defineDoc,
  defineDocFamily,
  defineTask,
  type Harness,
  type Conversation,
  type TaskId,
} from "@earendil-works/pi-durable";
import type { Context } from "@earendil-works/chord";
import type {
  AgentHarnessConnection,
  AgentHarnessEvent,
  AgentHarnessResult,
} from "@cueloop/schema";

type AcpReceipt = AgentHarnessResult;

type AcpCheckpoint = { phase: "queued" } | { phase: "dispatched" };

const AcpProgressDoc = defineDocFamily<{ events: string[]; bytes: number }, null>({
  kind: "cueloop.acp.progress",
  version: 1,
  family: true,
  scope: "conversation",
  history: "latest",
  fork: "initial",
  initial: () => ({ events: [], bytes: 0 }),
});

export const AcpSessionDoc = defineDoc<{
  sessionId: string | null;
  activeTask: TaskId<AcpReceipt> | null;
  operations: Record<string, { text: string; taskId: TaskId<AcpReceipt> }>;
}>({
  kind: "cueloop.acp",
  version: 1,
  scope: "conversation",
  history: "latest",
  fork: "initial",
  initial: () => ({ sessionId: null, activeTask: null, operations: {} }),
});

const TaskIdSchema = v.pipe(
  v.number(),
  v.integer(),
  v.minValue(1),
  v.maxValue(Number.MAX_SAFE_INTEGER),
);
const AcpSessionSchema = v.object({
  sessionId: v.nullable(v.string()),
  activeTask: v.nullable(TaskIdSchema),
  operations: v.record(v.string(), v.object({ text: v.string(), taskId: TaskIdSchema })),
});
const AcpProgressSchema = v.object({
  events: v.array(v.string()),
  bytes: v.pipe(v.number(), v.integer(), v.minValue(0), v.maxValue(8 * 1024 * 1024)),
});

type AcpSessionState = v.InferOutput<typeof AcpSessionSchema>;

export function validateAcpSession(document: AcpSessionState): void {
  v.parse(AcpSessionSchema, document);
}

function replayAcpProgress(
  events: readonly string[],
  publish: (event: AgentHarnessEvent) => void,
): void {
  const messages = new Map<string, Extract<AgentHarnessEvent, { kind: "message" }>>();

  for (const serialized of events) {
    const event = parseHarnessEvent(serialized);

    if (event.kind !== "message") {
      publish(event);
      continue;
    }
    const key = event.id ?? "answer";
    const previous = messages.get(key);

    messages.set(key, {
      ...event,
      text: event.replace ? event.text : (previous?.text ?? "") + event.text,
      replace: true,
    });
  }
  for (const message of messages.values()) publish(message);
}

/** Dispatch checkpoints prevent a daemon restart from repeating uncertain external effects. */
export function createDurableAcpTask(
  connection: () => Promise<AgentHarnessConnection>,
  publish: (event: AgentHarnessEvent) => void,
) {
  let commitEvent: ((event: AgentHarnessEvent) => void) | undefined;
  const task = defineTask<{ text: string }, AcpCheckpoint, AcpReceipt>({
    name: "cueloop.acp.prompt",
    version: 1,
    initial: () => ({ phase: "queued" }),
    phases: {
      queued: async (current, runtime, context) => {
        const backend = await connection();

        await runtime.commit(
          () => ({ status: "running", checkpoint: { phase: "dispatched" } }),
          context,
        );
        let progress = Promise.resolve();
        let progressError: unknown;

        commitEvent = (event) => {
          progress = progress
            .then(async () => {
              await runtime.commit(async (tx) => {
                const progress = await tx.doc(
                  AcpProgressDoc,
                  current.conversationId,
                  String(current.id),
                  null,
                );

                v.parse(AcpProgressSchema, progress);
                const serialized = JSON.stringify(event);
                const bytes = Buffer.byteLength(serialized);

                if (progress.bytes + bytes > 8 * 1024 * 1024)
                  throw new Error("ACP progress exceeds 8 MiB");
                progress.events.push(serialized);
                progress.bytes += bytes;

                return { status: "running", checkpoint: { phase: "dispatched" } };
              }, context);
              publish(event);
            })
            .catch((error) => {
              progressError = error;
            });
        };
        const cancel = () => backend.cancel();

        runtime.signal.addEventListener("abort", cancel, { once: true });
        try {
          const result = await backend.prompt(current.input.text, String(current.id));

          await progress;
          if (progressError) throw progressError;
          await runtime.commit(
            () => ({
              status: "terminal",
              outcome: {
                status: "completed",
                result,
              },
            }),
            context,
          );
        } finally {
          runtime.signal.removeEventListener("abort", cancel);
          commitEvent = undefined;
        }
      },
      dispatched: async (_current, runtime, context) => {
        await runtime.commit(
          () => ({
            status: "terminal",
            outcome: {
              status: "failed",
              error: {
                code: "acp-interrupted",
                message:
                  "Fx execution was interrupted after dispatch. Inspect its effects before retrying.",
              },
            },
          }),
          context,
        );
      },
    },
    abort: async (_current, runtime, context) => {
      await runtime.commit(() => ({ status: "terminal", outcome: { status: "aborted" } }), context);
    },
  });

  return {
    task,
    onEvent(event: AgentHarnessEvent) {
      if (commitEvent) commitEvent(event);
      else publish(event);
    },
    async prompt(
      harness: Harness,
      conversation: Conversation,
      text: string,
      requestId: string,
      context: Context,
    ) {
      let replay = false;
      const id = await conversation.commit(async (tx) => {
        const document = await tx.doc(AcpSessionDoc, conversation.id);

        validateAcpSession(document);
        const existing = document.operations[requestId];

        if (existing) {
          replay = true;
          if (existing.text !== text)
            throw new Error("ACP operation ID was reused with different input");

          return existing.taskId;
        }
        if (document.activeTask) {
          const active = await tx.task(document.activeTask);

          if (active && active.state.status !== "terminal")
            throw new Error("ACP conversation already has an active prompt");
        }
        const taskId = await tx.createTask(task, { text }, { ownership: { kind: "conversation" } });

        document.operations[requestId] = { text, taskId };
        document.activeTask = taskId;

        return taskId;
      }, context);
      const settled = await harness.waitForTask(id, context);
      const outcome = settled.state.outcome;

      if (replay) {
        const progress = await harness.snapshot(
          AcpProgressDoc,
          conversation.id,
          String(id),
          context,
        );

        if (progress) {
          v.parse(AcpProgressSchema, progress);
          replayAcpProgress(progress.events, publish);
        }
      }

      if (outcome.status === "completed") {
        return { outcome: outcome.result.outcome };
      }
      if (outcome.status === "aborted") return { outcome: "cancelled" as const };

      throw new Error(outcome.error?.message ?? "ACP execution failed");
    },
  };
}
