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
    display.push(...buildDisplay(`## ${message.role === "user" ? "You" : "fx"}`));
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
