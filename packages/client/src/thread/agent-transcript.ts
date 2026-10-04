import { resolve, relative, isAbsolute } from "node:path";
import {
  makeAnchor,
  parseBlocks,
  type AgentComment,
  type Thread,
  type ThreadAgentState,
} from "@cueloop/schema";
import {
  buildDisplay,
  marksByDisplay,
  renderedSpanToWork,
  type DisplayBlock,
  type Mark,
} from "../markdown/view-plan";
import type { TextSpan } from "../annotations/thread-selection";

/** One parsed agent transcript owns both display blocks and message selection coordinates. */
export function projectAgentTranscript(thread: Thread, state: ThreadAgentState) {
  const display: DisplayBlock[] = [];
  const offsets = new Map<string, number>();
  const sources: { messageId: string; blockIndex: number }[] = [];
  const annotations = state.comments.map((comment) => ({
    ...comment,
    kind: "comment",
    createdAt: thread.createdAt,
  }));

  for (const message of state.messages) {
    display.push(
      ...buildDisplay(`## ${message.role === "user" ? "You" : (state.harness?.label ?? "Agent")}`),
    );
    sources.push({ messageId: "", blockIndex: -1 });
    offsets.set(message.id, display.length);
    const blocks = buildDisplay(message.text);

    display.push(...blocks);
    sources.push(...blocks.map((_, blockIndex) => ({ messageId: message.id, blockIndex })));
    if (message.role === "user") {
      const tools = state.tools.filter((tool) => tool.turnId === message.id);

      if (tools.length) {
        display.push(
          ...buildDisplay(
            `${tools.length} tool ${tools.length === 1 ? "call" : "calls"} · ${tools.filter((tool) => tool.kind === "read").length} reads · ${tools.filter((tool) => tool.kind === "execute").length} commands`,
          ),
        );
        sources.push({ messageId: "", blockIndex: -1 });
      }
    }
  }
  const marks = new Map<number, Mark[]>();

  for (const message of state.messages) {
    const local = annotations.filter((annotation) => annotation.messageId === message.id);
    const offset = offsets.get(message.id)!;

    for (const [index, values] of marksByDisplay(local, buildDisplay(message.text)))
      marks.set(
        index + offset,
        values.map((mark) => ({
          ...mark,
          span: mark.span
            ? {
                start: { ...mark.span.start, blockIndex: mark.span.start.blockIndex + offset },
                end: { ...mark.span.end, blockIndex: mark.span.end.blockIndex + offset },
              }
            : undefined,
        })),
      );
  }
  const session: Thread = {
    ...thread,
    history: undefined,
    workingCopy: undefined,
    textCuts: undefined,
    artifact: { type: "plan", content: "", meta: {} },
    annotations,
    status: "pending",
    message: null,
  };

  return { display, marks, session, sources };
}

/** Agent feedback cannot span messages or bind to an unfinished answer. */
export function commentOnAgentSpan(
  thread: Thread,
  state: ThreadAgentState,
  span: TextSpan,
  body: string,
  id: string,
): AgentComment {
  const projection = projectAgentTranscript(thread, state);
  const start = projection.sources[span.start.blockIndex];
  const end = projection.sources[span.end.blockIndex];
  const message = state.messages.find((message) => message.id === start?.messageId);

  if (
    !message ||
    !start ||
    !end ||
    start.messageId !== end.messageId ||
    message.role !== "agent" ||
    !message.complete
  ) {
    throw new Error("Agent comment requires a selection within one completed answer");
  }

  const range = renderedSpanToWork(
    buildDisplay(message.text),
    start.blockIndex,
    end.blockIndex,
    span.start.char,
    span.end.char,
  );

  return {
    id,
    messageId: message.id,
    anchor: makeAnchor(
      parseBlocks(message.text),
      start.blockIndex,
      range.start,
      range.end,
      end.blockIndex,
    ),
    body,
    sent: false,
  };
}

/** Tool locations use the agent cwd; the file reader uses the repository root. */
export function agentToolFilePath(thread: Thread, path: string): string | undefined {
  const root = thread.workspace.repoRoot;
  const absolute = resolve(thread.artifact.meta.cwd ?? root, path);
  const local = relative(root, absolute);

  if (!local || local === ".." || local.startsWith("../") || isAbsolute(local)) return undefined;

  return local;
}

/** The artifact, mirrored discussions, answers, and tail share one navigation projection. */
export function projectThreadConversation(
  thread: Thread,
  state: ThreadAgentState,
  artifactDisplay: DisplayBlock[],
  artifactMarks: Map<number, Mark[]>,
) {
  const display = [...artifactDisplay];
  const marks = new Map(artifactMarks);
  const annotations = [...thread.annotations];
  const sources: (
    | { kind: "artifact" }
    | { kind: "message"; messageId: string; blockIndex: number }
    | { kind: "mirror"; commentId?: string }
    | { kind: "tail" }
    | { kind: "activity" }
  )[] = artifactDisplay.map(() => ({ kind: "artifact" }));
  const mirrors = new Map<string, { commentId?: string; submissionId?: string }>();
  const destinations = new Map<string, number>();
  const mirror = (
    id: string,
    body: string,
    quote: string,
    commentId?: string,
    submissionId?: string,
  ): void => {
    const blocks: DisplayBlock[] = buildDisplay(quote);
    if (!blocks.length)
      blocks.push({
        type: "same",
        kind: "p",
        work: { kind: "p", text: "", lineStart: 0, lineEnd: 0 },
      });
    const offset = display.length;
    const annotation = {
      id: `mirror:${id}`,
      kind: "comment",
      body,
      createdAt: thread.createdAt,
      anchor: {
        quote,
        prefix: "",
        suffix: "",
        blockIndex: 0,
        start: 0,
        end: (blocks[0]?.work ?? blocks[0]?.base)?.text.length ?? 0,
      },
    };

    display.push(...blocks);
    sources.push(...blocks.map(() => ({ kind: "mirror" as const, commentId })));
    annotations.push(annotation);
    if (commentId) {
      const replies = [...thread.annotations, ...state.comments].filter(
        (entry) => entry.replyTo === commentId,
      );
      for (const reply of replies) {
        const replica = {
          ...annotation,
          id: `${annotation.id}:${reply.id}`,
          body: reply.body,
          author: reply.author,
          replyTo: annotation.id,
        };

        annotations.push(replica);
        mirrors.set(replica.id, { commentId: reply.id });
      }
    }
    const localMarks = quote.trim()
      ? marksByDisplay([annotation], blocks)
      : new Map<number, Mark[]>([
          [
            0,
            [
              {
                start: 0,
                end: 0,
                role: "mark-comment",
                annotationId: annotation.id,
                span: { start: { blockIndex: 0, char: 0 }, end: { blockIndex: 0, char: 0 } },
              },
            ],
          ],
        ]);
    for (const [index, values] of localMarks) {
      marks.set(
        index + offset,
        values.map((mark) => ({
          ...mark,
          span: mark.span
            ? {
                start: { ...mark.span.start, blockIndex: mark.span.start.blockIndex + offset },
                end: { ...mark.span.end, blockIndex: mark.span.end.blockIndex + offset },
              }
            : undefined,
        })),
      );
    }
    mirrors.set(annotation.id, { commentId, submissionId });
    if (submissionId) destinations.set(submissionId, offset);
  };
  const message = (entry: ThreadAgentState["messages"][number]): void => {
    const projection = projectAgentTranscript(thread, {
      ...state,
      messages: [entry],
      tools: [],
      comments: state.comments.filter((comment) => comment.messageId === entry.id),
    });
    const offset = display.length;

    display.push(...projection.display.slice(1));
    sources.push(
      ...projection.sources.slice(1).map((source) => ({ kind: "message" as const, ...source })),
    );
    annotations.push(...projection.session.annotations);
    for (const [index, values] of projection.marks) {
      marks.set(
        index - 1 + offset,
        values.map((mark) => ({
          ...mark,
          span: mark.span
            ? {
                start: { ...mark.span.start, blockIndex: mark.span.start.blockIndex + offset - 1 },
                end: { ...mark.span.end, blockIndex: mark.span.end.blockIndex + offset - 1 },
              }
            : undefined,
        })),
      );
    }
  };
  if (state.submissions?.length) {
    for (const submission of state.submissions) {
      mirror(
        submission.id,
        submission.prompt,
        submission.quote ?? " ",
        submission.commentId,
        submission.id,
      );
      for (const entry of state.messages.filter(
        (entry) => entry.role === "agent" && entry.submissionId === submission.id,
      ))
        message(entry);
    }
  } else for (const entry of state.messages) message(entry);
  const activityIndex = display.length;

  display.push({
    type: "same",
    kind: "p",
    work: { kind: "p", text: "", lineStart: 0, lineEnd: 0 },
  });
  sources.push({ kind: "activity" });
  const tailIndex = display.length;

  display.push({
    type: "same",
    kind: "p",
    work: { kind: "p", text: "", lineStart: 0, lineEnd: 0 },
  });
  sources.push({ kind: "tail" });

  return {
    display,
    marks,
    sources,
    mirrors,
    destinations,
    activityIndex,
    tailIndex,
    session: { ...thread, annotations },
  };
}
