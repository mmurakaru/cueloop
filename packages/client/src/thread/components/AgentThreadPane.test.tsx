import { expect, test } from "bun:test";
import React from "react";
import { testRender } from "@opentui/react/test-utils";
import {
  SCHEMA_VERSION,
  type Thread,
  type ThreadAgentState,
  type AgentPromptRequest,
} from "@cueloop/schema";
import { AgentThreadPane, AgentThreadPrototype } from "./AgentThreadPane";
import { ThreadFooter } from "./ThreadFooter";
import { ThreadView } from "../../markdown/components/ThreadView";
import { buildDisplay, marksByDisplay } from "../../markdown/view-plan";
import { DARK } from "../../appearance/theme";
import {
  locateText,
  waitForText,
  pressKey,
  typeText,
  settle,
  waitForState,
} from "../../testing/test-support";
import type { ThreadAgentClient } from "../use-thread-agent";
import type { EventFrame } from "@cueloop/daemon/client";

const thread: Thread = {
  schemaVersion: SCHEMA_VERSION,
  id: "thread",
  workspace: { repoRoot: "/tmp/project", branch: "main" },
  artifact: { type: "plan", content: "Original artifact", meta: {} },
  annotations: [],
  revisions: [],
  status: "pending",
  message: null,
  createdAt: "2026-10-04",
};
const noop = () => {};
const empty: ThreadAgentState = {
  threadId: thread.id,
  phase: { kind: "idle" },
  messages: [],
  tools: [],
  comments: [],
};

function createTestAgentClient(initial: ThreadAgentState) {
  let state = initial;
  const prompts: AgentPromptRequest[] = [];
  const listeners = new Set<(event: EventFrame) => void>();
  const client: ThreadAgentClient = {
    onEvent: (listener) => {
      listeners.add(listener);

      return () => listeners.delete(listener);
    },
    agentGet: async () => state,
    agentPrompt: async (params) => {
      prompts.push(params);
      if (params.text)
        state = {
          ...state,
          messages: [
            ...state.messages,
            {
              id: `answer-${prompts.length}`,
              role: "agent",
              text: "The timer survives cancellation.",
              complete: true,
              revision: 1,
            },
          ],
        };

      return state;
    },
    agentCancel: async () => state,
    agentComment: async () => state,
    agentPermission: async () => ({ ...state, phase: { kind: "idle" } }),
  };

  const publishTestAgentState = (next: ThreadAgentState): void => {
    state = next;
    for (const listener of listeners) listener({ event: "agent.updated", sessionId: thread.id });
  };

  return { client, prompts, publishTestAgentState };
}

function artifactView(
  value: Thread,
  onReply: (id: string, body: string) => void = noop,
  onUpdateAnnotation: (id: string, body: string) => void = noop,
) {
  const display = buildDisplay(value.artifact.content);

  return (
    <ThreadView
      session={value}
      display={display}
      marks={marksByDisplay(value.annotations, display)}
      quickActions={[]}
      observer={false}
      onAnnotate={noop}
      onReply={onReply}
      onUpdateAnnotation={onUpdateAnnotation}
      onExit={noop}
    />
  );
}

test("typing on the final blank line invokes the agent while the existing footer keeps its action", async () => {
  const { client, prompts } = createTestAgentClient(empty);
  let reviewSubmissions = 0;
  const setup = await testRender(
    <box style={{ flexGrow: 1, flexDirection: "column" }}>
      <AgentThreadPane
        thread={thread}
        client={client}
        focused
        theme={DARK}
        onActiveChange={noop}
        onOpenFile={noop}
      >
        {artifactView(thread)}
      </AgentThreadPane>
      <ThreadFooter repo="project" branch="main" onSubmit={() => reviewSubmissions++} />
    </box>,
    { width: 100, height: 24, kittyKeyboard: true },
  );

  try {
    await waitForText(setup, "Original artifact");
    expect(setup.captureCharFrame()).not.toContain("Workspace:");
    expect(setup.captureCharFrame()).not.toContain("Ask Agent");
    const artifact = locateText(setup, "Original artifact");

    await setup.mockMouse.click(artifact.column, artifact.row);
    await typeText(setup, "Ignored unmarked input");
    expect(setup.captureCharFrame()).not.toContain("Ignored unmarked input");
    await setup.mockMouse.click(artifact.column, artifact.row + 2);
    await typeText(setup, "Explain");
    expect(setup.captureCharFrame()).not.toContain("● Explain");
    await pressKey(setup, "RETURN", { meta: true });
    expect(prompts).toHaveLength(0);
    await setup.mockMouse.click(artifact.column, artifact.row);
    await setup.mockMouse.click(artifact.column, artifact.row + 2);
    // Submit the typing burst before waiting for content-change repaint.
    await setup.mockInput.typeText(" retries");
    setup.mockInput.pressKey("RETURN", { ctrl: true });
    await waitForText(setup, "The timer survives cancellation.");
    expect(prompts[0]?.text).toBe("Explain retries");
    expect(prompts[0]?.inputOnly).toBe(true);
    const send = locateText(setup, "Send message (0)");

    await setup.mockMouse.click(send.column, send.row);
    expect(reviewSubmissions).toBe(1);
    expect(prompts).toHaveLength(1);
  } finally {
    setup.renderer.destroy();
  }
});

test("typing after a submitted original creates a reply instead of editing the frozen comment", async () => {
  const annotated: Thread = {
    ...thread,
    annotations: [
      {
        id: "original",
        kind: "comment",
        body: "Explain the timer",
        anchor: {
          quote: "Original",
          prefix: "",
          suffix: " artifact",
          blockIndex: 0,
          start: 0,
          end: 8,
        },
        createdAt: thread.createdAt,
      },
    ],
  };
  const state: ThreadAgentState = {
    ...empty,
    submissions: [
      {
        id: "turn",
        commentId: "original",
        prompt: "Explain the timer",
        quote: "Original",
        status: "completed",
      },
    ],
  };
  const { client } = createTestAgentClient(state);
  const replies: string[] = [];
  const updates: string[] = [];
  const setup = await testRender(
    <AgentThreadPane
      thread={annotated}
      client={client}
      focused
      theme={DARK}
      onActiveChange={noop}
      onOpenFile={noop}
    >
      {artifactView(
        annotated,
        (_id, body) => replies.push(body),
        (_id, body) => updates.push(body),
      )}
    </AgentThreadPane>,
    { width: 100, height: 24, kittyKeyboard: true },
  );

  try {
    await waitForText(setup, "✓✓");
    const original = locateText(setup, "Explain the timer");

    await setup.mockMouse.click(original.column, original.row);
    await typeText(setup, "What about cleanup?");
    await pressKey(setup, "RETURN", { ctrl: true });
    expect(replies).toEqual(["What about cleanup?"]);
    expect(updates).toEqual([]);
    expect(annotated.annotations[0]?.body).toBe("Explain the timer");
  } finally {
    setup.renderer.destroy();
  }
});

test("failed mirrors expose Retry and permissions keep activity at the bottom", async () => {
  const state: ThreadAgentState = {
    ...empty,
    submissions: [
      {
        id: "failed",
        commentId: "original",
        prompt: "Check retries",
        quote: "Original",
        status: "failed",
      },
    ],
    phase: {
      kind: "permission",
      permission: {
        id: "permission",
        title: "Run retry tests",
        options: [{ optionId: "deny", name: "Reject once", kind: "reject_once" }],
      },
    },
  };
  const { client, prompts } = createTestAgentClient(state);
  const setup = await testRender(
    <AgentThreadPane
      thread={thread}
      client={client}
      focused
      theme={DARK}
      onActiveChange={noop}
      onOpenFile={noop}
    >
      {artifactView(thread)}
    </AgentThreadPane>,
    { width: 100, height: 24, kittyKeyboard: true },
  );

  try {
    await waitForText(setup, "Run retry tests");
    const frame = setup.captureCharFrame();

    expect(frame.match(/Thinking/g)).toHaveLength(1);
    expect(frame.indexOf("Thinking")).toBeGreaterThan(frame.indexOf("Check retries"));
    const retry = locateText(setup, "Retry");

    await setup.mockMouse.click(retry.column, retry.row);
    expect(prompts[0]?.retry).toBe("failed");
    expect(prompts[0]?.text).toBe("");
  } finally {
    setup.renderer.destroy();
  }
});

test("three bottom prompts survive delayed acceptance and remain separate submissions", async () => {
  const { client } = createTestAgentClient(empty);
  let release: ((state: ThreadAgentState) => void) | undefined;
  const prompts: string[] = [];

  client.agentPrompt = async (params) => {
    prompts.push(params.text);
    if (prompts.length === 1)
      return new Promise((resolve) => {
        release = resolve;
      });

    return empty;
  };
  const setup = await testRender(
    <AgentThreadPane
      thread={thread}
      client={client}
      focused
      theme={DARK}
      onActiveChange={noop}
      onOpenFile={noop}
    >
      {artifactView(thread)}
    </AgentThreadPane>,
    { width: 100, height: 24, kittyKeyboard: true },
  );

  try {
    await waitForText(setup, "Original artifact");
    await pressKey(setup, "ARROW_DOWN");
    await pressKey(setup, "ARROW_DOWN");
    await typeText(setup, "First prompt");
    await pressKey(setup, "RETURN", { ctrl: true });
    await typeText(setup, "Second prompt");
    await pressKey(setup, "RETURN", { ctrl: true });
    await typeText(setup, "Third prompt");
    await pressKey(setup, "RETURN", { ctrl: true });
    expect(prompts).toEqual(["First prompt"]);
    release!(empty);
    await settle(setup);
    expect(prompts).toEqual(["First prompt", "Second prompt", "Third prompt"]);
  } finally {
    setup.renderer.destroy();
  }
});

test("typing on an accepted plain prompt cannot edit it or create an unmarked comment", async () => {
  const state: ThreadAgentState = {
    ...empty,
    messages: [
      { id: "prompt", role: "user", text: "Explain retries", complete: true, revision: 1 },
    ],
    submissions: [
      { id: "prompt", commentId: "prompt", prompt: "Explain retries", status: "completed" },
    ],
  };
  const { client } = createTestAgentClient(state);
  const replies: string[] = [];

  client.agentComment = async (params) => {
    replies.push(params.comment.replyTo ?? "");

    return state;
  };
  const setup = await testRender(
    <AgentThreadPane
      thread={thread}
      client={client}
      focused
      theme={DARK}
      onActiveChange={noop}
      onOpenFile={noop}
    >
      {artifactView(thread)}
    </AgentThreadPane>,
    { width: 100, height: 24, kittyKeyboard: true },
  );

  try {
    await waitForText(setup, "Explain retries");
    const prompt = locateText(setup, "Explain retries");

    await setup.mockMouse.click(prompt.column, prompt.row);
    await typeText(setup, "What about cancellation?");
    await pressKey(setup, "RETURN", { ctrl: true });
    expect(replies).toEqual([]);
    expect(state.messages[0]?.text).toBe("Explain retries");
    expect(setup.captureCharFrame()).not.toContain("What about cancellation?");
  } finally {
    setup.renderer.destroy();
  }
});

for (const editingReply of [false, true]) {
  test(`Option+Enter preserves the exact ${editingReply ? "edited" : "new"} reply for Ctrl+Enter`, async () => {
    const submitted: string[] = [];
    const root = {
      id: "root",
      kind: "comment" as const,
      body: "Submitted question",
      createdAt: "2026-10-04",
      anchor: { quote: "Original", prefix: "", suffix: " artifact" },
    };
    const display = buildDisplay(thread.artifact.content);

    function ControlledDiscussion(): React.ReactNode {
      const [value, setValue] = React.useState<Thread>({
        ...thread,
        annotations: editingReply
          ? [root, { ...root, id: "reply", replyTo: "root", body: "Editable followup" }]
          : [root],
      });
      const [focused, setFocused] = React.useState<string>();

      return (
        <ThreadView
          session={value}
          display={display}
          marks={marksByDisplay(value.annotations, display)}
          quickActions={[]}
          observer={false}
          focusedAnnotationId={focused}
          onFocusAnnotation={setFocused}
          isAnnotationReadOnly={(id) => id === "root"}
          onAnnotate={noop}
          onReply={(id, body) => {
            setValue((current) => ({
              ...current,
              annotations: [...current.annotations, { ...root, id: "reply", replyTo: id, body }],
            }));

            return "reply";
          }}
          onUpdateAnnotation={(id, body) =>
            setValue((current) => ({
              ...current,
              annotations: current.annotations.map((note) =>
                note.id === id ? { ...note, body } : note,
              ),
            }))
          }
          onInvoke={(id) => {
            if (id) submitted.push(id);
          }}
          onExit={noop}
        />
      );
    }
    const setup = await testRender(<ControlledDiscussion />, {
      width: 100,
      height: 24,
      kittyKeyboard: true,
    });

    try {
      await waitForText(setup, editingReply ? "Editable followup" : "Submitted question");
      const comment = locateText(setup, editingReply ? "Editable followup" : "Submitted question");

      await setup.mockMouse.click(comment.column, comment.row);
      await typeText(setup, " Why?");
      await pressKey(setup, "RETURN", { meta: true });
      expect(submitted).toEqual([]);
      await pressKey(setup, "RETURN", { ctrl: true });
      expect(submitted).toEqual(["reply"]);
    } finally {
      setup.renderer.destroy();
    }
  });
}

test("Ctrl+Enter submits only the comment just saved, leaving older notes editable", async () => {
  const value: Thread = {
    ...thread,
    annotations: [
      {
        id: "older",
        kind: "comment",
        body: "Older unsent note",
        createdAt: "2026-10-04",
        anchor: { quote: "Original", prefix: "", suffix: " artifact" },
      },
    ],
  };
  const { client, prompts } = createTestAgentClient(empty);
  const display = buildDisplay(value.artifact.content);
  const setup = await testRender(
    <AgentThreadPane
      thread={value}
      theme={DARK}
      focused
      onActiveChange={noop}
      onOpenFile={noop}
      client={client}
    >
      <ThreadView
        session={value}
        display={display}
        marks={marksByDisplay(value.annotations, display)}
        quickActions={[]}
        observer={false}
        onAnnotate={() => "selected"}
        onReply={noop}
        onUpdateAnnotation={noop}
        onExit={noop}
      />
    </AgentThreadPane>,
    { width: 100, height: 24, kittyKeyboard: true },
  );

  try {
    await waitForText(setup, "Original artifact");
    const artifact = locateText(setup, "Original artifact");

    await setup.mockMouse.drag(
      artifact.column + 9,
      artifact.row,
      artifact.column + 17,
      artifact.row,
    );
    await typeText(setup, "Only this question");
    await pressKey(setup, "RETURN", { ctrl: true });
    await waitForState(setup, () => prompts.length === 1, "selected comment invocation");
    expect(prompts[0]?.commentId).toBe("selected");
    expect(prompts[0]?.id).toBe(value.id);
    expect(value.annotations[0]?.body).toBe("Older unsent note");
  } finally {
    setup.renderer.destroy();
  }
});

test("Option+Enter saves a comment, Command+Enter leaves its draft, and Ctrl+Enter invokes", async () => {
  const saved: string[] = [];
  let invocations = 0;
  const display = buildDisplay(thread.artifact.content);
  const setup = await testRender(
    <ThreadView
      session={thread}
      display={display}
      marks={marksByDisplay([], display)}
      quickActions={[]}
      observer={false}
      onAnnotate={(_span, body) => {
        saved.push(body);

        return `saved-${saved.length}`;
      }}
      onReply={noop}
      onUpdateAnnotation={noop}
      onExit={noop}
      onInvoke={() => invocations++}
    />,
    { width: 100, height: 24, kittyKeyboard: true },
  );

  try {
    await waitForText(setup, "Original artifact");
    const artifact = locateText(setup, "Original artifact");

    await setup.mockMouse.drag(artifact.column, artifact.row, artifact.column + 8, artifact.row);
    await typeText(setup, "Editable comment");
    setup.mockInput.pressKey("RETURN", { super: true });
    await settle(setup);
    expect(saved).toEqual([]);
    expect(invocations).toBe(0);
    expect(setup.captureCharFrame()).toContain("Editable comment");
    await pressKey(setup, "RETURN", { meta: true });
    expect(saved).toEqual(["Editable comment"]);
    expect(invocations).toBe(0);
    await setup.mockMouse.drag(artifact.column, artifact.row, artifact.column + 8, artifact.row);
    await typeText(setup, "Ask the agent");
    await pressKey(setup, "RETURN", { ctrl: true });
    expect(saved).toEqual(["Editable comment", "Ask the agent"]);
    expect(invocations).toBe(1);
  } finally {
    setup.renderer.destroy();
  }
});

test("comments on a later paragraph of agent output save editable and submit independently", async () => {
  let state: ThreadAgentState = {
    ...empty,
    messages: [
      { id: "earlier", role: "agent", text: "Earlier reply.", complete: true, revision: 1 },
      {
        id: "output",
        role: "agent",
        text: "First paragraph.\n\nThe agent can explain this comment.\n\nLast paragraph.",
        complete: true,
        revision: 2,
      },
    ],
  };
  const { client, prompts } = createTestAgentClient(state);

  client.agentComment = async ({ comment }) => {
    state = {
      ...state,
      comments: [...state.comments.filter((entry) => entry.id !== comment.id), comment],
    };

    return state;
  };
  const prompt = client.agentPrompt;

  client.agentPrompt = async (params) => {
    await prompt(params);
    state = { ...state, comments: state.comments.map((comment) => ({ ...comment, sent: true })) };

    return state;
  };
  const setup = await testRender(
    <AgentThreadPane
      thread={thread}
      client={client}
      focused
      theme={DARK}
      onActiveChange={noop}
      onOpenFile={noop}
    >
      {artifactView(thread)}
    </AgentThreadPane>,
    { width: 100, height: 30, kittyKeyboard: true },
  );

  try {
    await waitForText(setup, "The agent can explain");
    await waitForState(
      setup,
      () => setup.renderer.getCursorState().visible,
      "continuation composer ready",
    );
    const output = locateText(setup, "The agent can explain");

    await setup.mockMouse.drag(output.column, output.row, output.column + 9, output.row);
    await typeText(setup, "Explain this to me");
    await pressKey(setup, "RETURN", { meta: true });
    await waitForState(setup, () => state.comments.length === 1, "agent output comment saved");
    expect(state.comments).toHaveLength(1);
    expect(state.comments[0]?.messageId).toBe("output");
    expect(state.comments[0]?.anchor.quote).toBe("The agent");
    expect(state.comments[0]?.sent).toBe(false);
    expect(prompts).toHaveLength(0);
    expect(setup.captureCharFrame()).toContain("Explain this to me");
    await pressKey(setup, "RETURN", { ctrl: true });
    expect(prompts).toHaveLength(1);
    expect(state.comments[0]?.sent).toBe(true);
  } finally {
    setup.renderer.destroy();
  }
});

for (const policy of [
  { enabled: false, observer: false, pixelPrototype: false },
  { enabled: true, observer: true, pixelPrototype: false },
]) {
  test(`disabled or shared agent views retain the original document without opening a harness (${JSON.stringify(policy)})`, async () => {
    let reads = 0;
    const { client } = createTestAgentClient(empty);

    client.agentGet = async () => {
      reads++;

      return empty;
    };
    const setup = await testRender(
      <AgentThreadPrototype
        {...policy}
        thread={thread}
        client={client}
        focused
        theme={DARK}
        onActiveChange={noop}
        onOpenFile={noop}
      >
        {artifactView(thread)}
      </AgentThreadPrototype>,
      { width: 100, height: 24 },
    );

    try {
      await waitForText(setup, "Original artifact");
      expect(reads).toBe(0);
      expect(setup.captureCharFrame()).not.toContain("Thinking");
    } finally {
      setup.renderer.destroy();
    }
  });
}

test("empty Thread typing and accepted prompts use normal paragraph padding without comment cards", async () => {
  const value = { ...thread, artifact: { ...thread.artifact, content: "" } };
  let accepted = empty;
  const { client, prompts } = createTestAgentClient(empty);

  client.agentPrompt = async (params) => {
    prompts.push(params);
    accepted = {
      ...empty,
      submissions: [
        { id: "plain-prompt", commentId: "plain-prompt", prompt: params.text, status: "completed" },
      ],
    };

    return accepted;
  };
  const setup = await testRender(
    <AgentThreadPane
      thread={value}
      client={client}
      focused
      theme={DARK}
      onActiveChange={noop}
      onOpenFile={noop}
    >
      {artifactView(value)}
    </AgentThreadPane>,
    { width: 100, height: 24, kittyKeyboard: true },
  );

  try {
    await settle(setup);
    await pressKey(setup, "ARROW_DOWN");
    await typeText(setup, "Hello from the prompt");
    expect(locateText(setup, "Hello from the prompt")).toMatchObject({ row: 1, column: 2 });
    await pressKey(setup, "RETURN", { ctrl: true });
    await waitForText(setup, "Hello from the prompt");
    expect(prompts).toHaveLength(1);
    expect(locateText(setup, "Hello from the prompt")).toMatchObject({ row: 1, column: 2 });
    expect(setup.captureCharFrame()).not.toContain("●");
    expect(setup.captureCharFrame()).not.toContain("✓");
  } finally {
    setup.renderer.destroy();
  }
});

test("clicking whitespace below the conversation focuses a blinking prompt before typing", async () => {
  const { client, prompts } = createTestAgentClient(empty);
  const setup = await testRender(
    <AgentThreadPane
      thread={thread}
      client={client}
      focused
      theme={DARK}
      onActiveChange={noop}
      onOpenFile={noop}
    >
      {artifactView(thread)}
    </AgentThreadPane>,
    { width: 100, height: 24, kittyKeyboard: true },
  );

  try {
    await waitForText(setup, "Original artifact");
    const text = locateText(setup, "Original artifact");

    await setup.mockMouse.click(text.column + 20, text.row + 5);
    await waitForState(
      setup,
      () => {
        const cursor = setup.renderer.getCursorState();

        return cursor.visible && cursor.blinking;
      },
      "continuation cursor focused",
    );
    expect(setup.renderer.getCursorState()).toMatchObject({ visible: true, blinking: true });
    expect(prompts).toHaveLength(0);
    await typeText(setup, "A prompt from whitespace");
    await pressKey(setup, "RETURN", { ctrl: true });
    expect(prompts[0]?.text).toBe("A prompt from whitespace");
    await waitForText(setup, "The timer survives cancellation.");
    await settle(setup);
    const answer = locateText(setup, "The timer survives cancellation.");
    const cursor = setup.renderer.getCursorState();

    expect(cursor).toMatchObject({ visible: true, blinking: true, x: 3 });
    expect(cursor.y).toBeGreaterThan(answer.row + 1);
    await typeText(setup, "Continue after the reply");
    await pressKey(setup, "RETURN", { ctrl: true });
    expect(prompts[1]?.text).toBe("Continue after the reply");
  } finally {
    setup.renderer.destroy();
  }
});

test("an arriving reply preserves a bottom draft and submits it as the next prompt", async () => {
  const { client, prompts } = createTestAgentClient(empty);
  let finish: ((state: ThreadAgentState) => void) | undefined;
  const answer: ThreadAgentState = {
    ...empty,
    messages: [
      {
        id: "arriving-answer",
        role: "agent",
        text: "An answer has arrived.",
        complete: true,
        revision: 1,
      },
    ],
  };

  client.agentPrompt = async (params) => {
    prompts.push(params);
    if (prompts.length === 1)
      return new Promise<ThreadAgentState>((resolve) => {
        finish = resolve;
      });

    return answer;
  };
  const setup = await testRender(
    <AgentThreadPane
      thread={thread}
      client={client}
      focused
      theme={DARK}
      onActiveChange={noop}
      onOpenFile={noop}
    >
      {artifactView(thread)}
    </AgentThreadPane>,
    { width: 100, height: 24, kittyKeyboard: true },
  );

  try {
    await waitForText(setup, "Original artifact");
    const artifact = locateText(setup, "Original artifact");

    await setup.mockMouse.click(artifact.column + 20, artifact.row + 5);
    await typeText(setup, "First prompt");
    await pressKey(setup, "RETURN", { ctrl: true });
    await setup.mockMouse.click(artifact.column + 20, artifact.row + 5);
    await typeText(setup, "Preserved second prompt");
    finish!(answer);
    await waitForText(setup, "An answer has arrived.");
    expect(setup.captureCharFrame()).toContain("Preserved second prompt");
    await typeText(setup, " after completion");
    await pressKey(setup, "RETURN", { ctrl: true });
    expect(prompts[1]?.text).toBe("Preserved second prompt after completion");
  } finally {
    setup.renderer.destroy();
  }
});

test("clicking the first blank row after a reply opens continuation without losing a draft", async () => {
  const state: ThreadAgentState = {
    ...empty,
    messages: [
      { id: "answer", role: "agent", text: "The final reply.", complete: true, revision: 1 },
    ],
  };
  const { client, prompts } = createTestAgentClient(state);
  const setup = await testRender(
    <AgentThreadPane
      thread={thread}
      client={client}
      focused
      theme={DARK}
      onActiveChange={noop}
      onOpenFile={noop}
    >
      {artifactView(thread)}
    </AgentThreadPane>,
    { width: 100, height: 24, kittyKeyboard: true },
  );

  try {
    await waitForText(setup, "The final reply.");
    await waitForState(
      setup,
      () => setup.renderer.currentFocusedEditor !== null,
      "initial continuation focus ready",
    );
    await pressKey(setup, "ESCAPE");
    await waitForState(
      setup,
      () => setup.renderer.currentFocusedEditor === null,
      "continuation dismissed",
    );
    const reply = locateText(setup, "The final reply.");

    await setup.mockMouse.click(reply.column + 5, reply.row + 1);
    await waitForState(
      setup,
      () => {
        const cursor = setup.renderer.getCursorState();

        return setup.renderer.currentFocusedEditor !== null && cursor.visible && cursor.blinking;
      },
      "continuation cursor focused",
    );
    expect(setup.renderer.getCursorState()).toMatchObject({ visible: true, blinking: true });
    await typeText(setup, "Continue here");
    await setup.mockMouse.click(reply.column + 5, reply.row + 1);
    await waitForState(
      setup,
      () => {
        const cursor = setup.renderer.getCursorState();

        return setup.renderer.currentFocusedEditor !== null && cursor.visible && cursor.blinking;
      },
      "continuation cursor focused",
    );
    expect(setup.renderer.getCursorState()).toMatchObject({ visible: true, blinking: true });
    await pressKey(setup, "RETURN", { ctrl: true });
    expect(prompts[0]?.text).toBe("Continue here");
  } finally {
    setup.renderer.destroy();
  }
});

test("a rejected prompt returns visibly to the composer and can be edited before retry", async () => {
  const { client, prompts } = createTestAgentClient(empty);
  let reject = true;
  const acceptPrompt = client.agentPrompt;

  client.agentPrompt = async (params) => {
    if (reject) {
      reject = false;
      throw new Error("Prompt rejected");
    }

    return acceptPrompt(params);
  };
  const setup = await testRender(
    <AgentThreadPane
      thread={thread}
      client={client}
      focused
      theme={DARK}
      onActiveChange={noop}
      onOpenFile={noop}
    >
      {artifactView(thread)}
    </AgentThreadPane>,
    { width: 100, height: 24, kittyKeyboard: true },
  );

  try {
    await waitForText(setup, "Original artifact");
    const artifact = locateText(setup, "Original artifact");

    await setup.mockMouse.click(artifact.column, artifact.row + 2);
    await typeText(setup, "Explain retries");
    await pressKey(setup, "RETURN", { ctrl: true });
    await waitForText(setup, "Prompt rejected");
    expect(setup.captureCharFrame()).toContain("Explain retries");
    await typeText(setup, " please");
    await pressKey(setup, "RETURN", { ctrl: true });
    await waitForText(setup, "The timer survives cancellation.");
    expect(prompts[0]?.text).toBe("Explain retries please");
  } finally {
    setup.renderer.destroy();
  }
});

test("a failed mutation flush restores the prompt alongside a newer visible draft", async () => {
  const { client, prompts } = createTestAgentClient(empty);
  let failFlush: ((reason: Error) => void) | undefined;
  let flushStarted = false;
  const failedFlush = new Promise<void>((_resolve, reject) => {
    failFlush = reject;
  });
  const setup = await testRender(
    <AgentThreadPane
      thread={thread}
      client={client}
      focused
      theme={DARK}
      onActiveChange={noop}
      onOpenFile={noop}
      flushMutations={() => {
        if (flushStarted) return Promise.resolve();
        flushStarted = true;

        return failedFlush;
      }}
    >
      {artifactView(thread)}
    </AgentThreadPane>,
    { width: 100, height: 24, kittyKeyboard: true },
  );

  try {
    await waitForText(setup, "Original artifact");
    const artifact = locateText(setup, "Original artifact");

    await setup.mockMouse.click(artifact.column, artifact.row + 2);
    await typeText(setup, "First question");
    await pressKey(setup, "RETURN", { ctrl: true });
    await waitForState(setup, () => flushStarted, "mutation flush started");
    await setup.mockMouse.click(artifact.column, artifact.row + 2);
    await typeText(setup, "Newer draft");
    failFlush!(new Error("Mutation flush failed"));
    await waitForText(setup, "Mutation flush failed");
    await waitForText(setup, "First question");
    expect(setup.captureCharFrame()).toContain("Newer draft");
    await typeText(setup, " edited");
    await pressKey(setup, "RETURN", { ctrl: true });
    await waitForText(setup, "The timer survives cancellation.");
    expect(prompts[0]?.text).toBe("First question\nNewer draft edited");
  } finally {
    setup.renderer.destroy();
  }
});

test("an offline shared agent accepts continuation below its status without model controls", async () => {
  const state: ThreadAgentState = {
    ...empty,
    messages: [
      { id: "online-answer", role: "agent", text: "An online answer", complete: true, revision: 1 },
    ],
  };
  const { client, prompts, publishTestAgentState } = createTestAgentClient(state);
  const setup = await testRender(
    <AgentThreadPane
      thread={thread}
      client={client}
      focused
      theme={DARK}
      onActiveChange={noop}
      onOpenFile={noop}
    >
      {artifactView(thread)}
    </AgentThreadPane>,
    { width: 80, height: 15, kittyKeyboard: true },
  );

  try {
    await waitForText(setup, "An online answer");
    await waitForState(
      setup,
      () => setup.renderer.currentFocusedEditor !== null,
      "online continuation editor",
    );
    publishTestAgentState({ ...state, phase: { kind: "offline" } });
    await waitForText(setup, "Owner offline");
    expect(setup.captureCharFrame()).toContain("Original artifact");
    expect(setup.captureCharFrame()).not.toContain("Thinking");
    const status = locateText(setup, "Owner offline");

    await setup.mockMouse.click(status.column + 5, status.row + 3);
    await waitForState(
      setup,
      () => setup.renderer.currentFocusedEditor !== null,
      "offline continuation editor",
    );
    await typeText(setup, "Queue until the owner reconnects");
    await waitForText(setup, "Queue until the owner reconnects");
    await pressKey(setup, "RETURN", { ctrl: true });
    expect(prompts[0]?.text).toBe("Queue until the owner reconnects");
    expect(prompts[0]?.inputOnly).toBe(true);
  } finally {
    setup.renderer.destroy();
  }
});

test("shared viewers see pending activity without owner permission controls", async () => {
  const { client } = createTestAgentClient({
    ...empty,
    phase: {
      kind: "permission",
      permission: {
        id: "owner-permission",
        title: "Owner approval required",
        options: [{ optionId: "allow", name: "Allow once", kind: "allow_once" }],
      },
    },
  });

  client.canControlAgent = false;
  const setup = await testRender(
    <AgentThreadPane
      thread={thread}
      client={client}
      focused
      theme={DARK}
      onActiveChange={noop}
      onOpenFile={noop}
    >
      {artifactView(thread)}
    </AgentThreadPane>,
    { width: 80, height: 15 },
  );

  try {
    await waitForText(setup, "Thinking");
    expect(setup.captureCharFrame()).not.toContain("Allow once");
    expect(setup.captureCharFrame()).not.toContain("Owner approval required");
  } finally {
    setup.renderer.destroy();
  }
});
