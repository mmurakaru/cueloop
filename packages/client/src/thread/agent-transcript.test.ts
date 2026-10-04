import { expect, test } from "bun:test";
import { SCHEMA_VERSION, type Thread, type ThreadAgentState } from "@cueloop/schema";
import {
  projectAgentTranscript,
  projectThreadConversation,
  commentOnAgentSpan,
  agentToolFilePath,
} from "./agent-transcript";

import { buildDisplay, marksByDisplay } from "../markdown/view-plan";

const thread: Thread = {
  schemaVersion: SCHEMA_VERSION,
  id: "thread",
  workspace: { repoRoot: "/tmp", branch: "main" },
  artifact: { type: "plan", content: "Original artifact", meta: {} },
  annotations: [],
  revisions: [],
  status: "pending",
  message: null,
  createdAt: "2026-10-04",
};
const state: ThreadAgentState = {
  threadId: "thread",
  phase: { kind: "idle" },
  tools: [],
  comments: [],
  messages: [
    { id: "question", role: "user", text: "Why?", complete: true, revision: 1 },
    { id: "answer-1", role: "agent", text: "Same quote.", complete: true, revision: 1 },
    { id: "answer-2", role: "agent", text: "Same quote.", complete: true, revision: 1 },
  ],
};

test("repeated quotes bind to the chosen answer instead of an earlier message", () => {
  const comment = commentOnAgentSpan(
    thread,
    state,
    { start: { blockIndex: 5, char: 0 }, end: { blockIndex: 5, char: 4 } },
    "Explain",
    "note",
  );
  const projected = projectAgentTranscript(thread, { ...state, comments: [comment] });

  expect(comment.messageId).toBe("answer-2");
  expect(comment.anchor.quote).toBe("Same");
  expect(projected.marks.has(5)).toBe(true);
  expect(projected.marks.has(3)).toBe(false);
  expect(thread.artifact.content).toBe("Original artifact");
});

test("a question, a cross-message selection, or a changing answer cannot accept feedback", () => {
  const span = { start: { blockIndex: 1, char: 0 }, end: { blockIndex: 1, char: 3 } };

  expect(() => commentOnAgentSpan(thread, state, span, "note", "id")).toThrow();
  expect(() =>
    commentOnAgentSpan(
      thread,
      state,
      { ...span, start: { blockIndex: 3, char: 0 }, end: { blockIndex: 5, char: 4 } },
      "note",
      "id",
    ),
  ).toThrow();
  expect(() =>
    commentOnAgentSpan(
      thread,
      { ...state, messages: state.messages.map((message) => ({ ...message, complete: false })) },
      { ...span, start: { blockIndex: 3, char: 0 }, end: { blockIndex: 3, char: 4 } },
      "note",
      "id",
    ),
  ).toThrow();
});

test("tool locations open the correct repository file from a subdirectory cwd", () => {
  const nested: Thread = {
    ...thread,
    workspace: { repoRoot: "/repo", branch: "main" },
    artifact: { ...thread.artifact, meta: { cwd: "/repo/packages/client" } },
  };

  expect(agentToolFilePath(nested, "/repo/packages/client/src/App.tsx")).toBe(
    "packages/client/src/App.tsx",
  );
  expect(agentToolFilePath(nested, "src/App.tsx")).toBe("packages/client/src/App.tsx");
  expect(agentToolFilePath(nested, "../../README.md")).toBe("README.md");
  expect(agentToolFilePath(nested, "/outside/README.md")).toBeUndefined();
  expect(agentToolFilePath(nested, "../../../outside.ts")).toBeUndefined();
});

test("editable artifact and agent comments stay inline until accepted for invocation", () => {
  const comment = commentOnAgentSpan(
    thread,
    state,
    { start: { blockIndex: 3, char: 0 }, end: { blockIndex: 3, char: 4 } },
    "Explain the answer",
    "agent-note",
  );
  const artifactNote = {
    id: "artifact-note",
    kind: "comment" as const,
    body: "Explain the artifact",
    createdAt: thread.createdAt,
    anchor: { quote: "Original", prefix: "", suffix: " artifact", blockIndex: 0, start: 0, end: 8 },
  };
  const annotated = { ...thread, annotations: [artifactNote] };
  const pending = { ...state, comments: [comment] };
  const display = buildDisplay(thread.artifact.content);
  const marks = marksByDisplay(annotated.annotations, display);
  const inline = projectThreadConversation(annotated, pending, display, marks);

  expect(inline.mirrors.size).toBe(0);
  expect(inline.session.annotations.some((entry) => entry.id === artifactNote.id)).toBe(true);
  expect(inline.session.annotations.some((entry) => entry.id === comment.id)).toBe(true);
  const submitted = projectThreadConversation(
    annotated,
    {
      ...pending,
      submissions: [
        {
          id: "accepted",
          commentId: artifactNote.id,
          prompt: artifactNote.body,
          quote: artifactNote.anchor.quote,
          status: "queued",
        },
      ],
    },
    display,
    marks,
  );

  expect(submitted.mirrors.size).toBe(1);
  expect(submitted.mirrors.get("mirror:accepted")?.commentId).toBe(artifactNote.id);
});
