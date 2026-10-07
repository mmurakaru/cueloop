import React, { useEffect, useEffectEvent, useMemo, useRef, useState } from "react";
import {
  newAnnotationId,
  agentCommentRoot,
  type Thread,
  type ThreadAgentState,
} from "@cueloop/schema";
import type { Theme } from "../../appearance/theme";
import { ThreadView, type ThreadViewProps } from "../../markdown/components/ThreadView";
import { buildDisplay, marksByDisplay } from "../../markdown/view-plan";
import { projectThreadConversation, commentOnAgentSpan } from "../agent-transcript";
import { useThreadAgent, type ThreadAgentClient } from "../use-thread-agent";
import { agentContinuation } from "../agent-continuation";
import { AgentConfigControls } from "./AgentConfigControls";

/** The opt-in prototype extends the existing Thread body and retains its surrounding chrome. */
export interface AgentThreadPaneProps {
  thread: Thread;
  home?: string;
  theme: Theme;
  children: React.ReactNode;
  focused: boolean;
  suspended?: boolean;
  onActiveChange: (active: boolean) => void;
  onOpenFile: (path: string) => void;
  onNextPane?: (backward: boolean) => void;
  onControlsChange?: (controls: React.ReactNode) => void;
  onActionsChange?: (
    action: (id: string) => { label: string; run: () => void } | undefined,
  ) => void;
  onRevealReply?: () => void;
  onInvokeChange?: (invoke: ((commentId?: string) => void) | undefined) => void;
  onStateChange?: (state: ThreadAgentState) => void;
  flushMutations?: () => Promise<void>;
  client?: ThreadAgentClient;
}

/** Inline input and the final blank line invoke the harness without replacing Send message. */
export function AgentThreadPane(props: AgentThreadPaneProps): React.ReactNode {
  const { thread, theme } = props;
  const agent = useThreadAgent(thread.id, props.home, props.client);
  const child =
    React.isValidElement<ThreadViewProps>(props.children) && props.children.type === ThreadView
      ? props.children.props
      : undefined;
  const baseDisplay =
    child?.display ??
    buildDisplay(
      thread.artifact.type === "diff"
        ? (thread.artifact.meta.prBrief ?? "")
        : (thread.workingCopy ?? thread.artifact.content),
    );
  const baseMarks = child?.marks ?? marksByDisplay(thread.annotations, baseDisplay);
  const projection = useMemo(
    () =>
      projectThreadConversation(
        thread,
        agent.state,
        baseDisplay,
        baseMarks,
        agent.state.phase.kind !== "idle" || Boolean(agent.error),
      ),
    [thread, agent.state, agent.error, baseDisplay, baseMarks],
  );
  const [requestedBlock, setRequestedBlock] = useState<{ blockIndex: number }>();
  const draft = useRef("");
  const [promptRestoreRequest, setPromptRestoreRequest] =
    useState<ThreadViewProps["promptRestoreRequest"]>();
  const restoreSequence = useRef(0);
  const invoking = useRef(false);
  const invocations = useRef<{ text: string; commentId?: string; writes: Promise<boolean>[] }[]>(
    [],
  );
  const pendingWrites = useRef<Promise<boolean>[]>([]);
  const state = agent.state;
  const continuation = agentContinuation(state);
  const busy = state.phase.kind === "running" || state.phase.kind === "permission";

  const [pulse, setPulse] = useState(false);

  useEffect(() => {
    if (!busy) return;
    const timer = setInterval(() => setPulse((value) => !value), 600);

    return () => clearInterval(timer);
  }, [busy]);
  const notifyActive = useEffectEvent((active: boolean) => props.onActiveChange(active));
  const notifyState = useEffectEvent(() => props.onStateChange?.(state));
  const notifyControls = useEffectEvent(() =>
    props.onControlsChange?.(
      props.client && !props.client.agentConfigure ? null : (
        <AgentConfigControls
          state={state}
          theme={theme}
          onConfigure={(configId, value) =>
            void agent.act((client) => {
              if (!client.agentConfigure)
                return Promise.reject(new Error("Agent configuration is unavailable"));

              return client.agentConfigure({ id: thread.id, configId, value });
            })
          }
        />
      ),
    ),
  );

  useEffect(() => {
    notifyActive(true);

    return () => notifyActive(false);
  }, []);
  useEffect(() => {
    notifyState();
  }, [state]);
  useEffect(() => {
    notifyControls();
  }, [state, theme]);

  const invoke = async (commentId?: string): Promise<void> => {
    if (thread.status !== "pending") return;
    if (!commentId && !draft.current.trim()) return;
    invocations.current.push({
      text: draft.current,
      commentId: commentId
        ? (projection.mirrors.get(commentId)?.commentId ?? commentId)
        : undefined,
      writes: pendingWrites.current.splice(0),
    });
    draft.current = "";
    if (invoking.current) return;
    invoking.current = true;

    const rejected: string[] = [];

    try {
      while (invocations.current.length) {
        const input = invocations.current.shift()!;

        try {
          const writesSaved = (await Promise.all(input.writes)).every(Boolean);

          if (!writesSaved) {
            rejected.push(input.text);
            continue;
          }
          await props.flushMutations?.();
          const accepted = await agent.act((client) =>
            client.agentPrompt({
              id: thread.id,
              text: input.text,
              commentId: input.commentId,
              inputOnly: Boolean(input.text.trim()),
              operationId: newAnnotationId(),
            }),
          );

          if (!accepted) rejected.push(input.text);
        } catch (error) {
          rejected.push(input.text);
          agent.setError(String(error));
        }
      }
    } finally {
      invoking.current = false;
      const text = rejected.filter(Boolean).join("\n");

      if (text) setPromptRestoreRequest({ id: ++restoreSequence.current, text });
    }
  };
  const invokeRef = useRef<(commentId?: string) => Promise<void>>(async () => {});

  useEffect(() => {
    invokeRef.current = invoke;
  });
  const notifyInvoke = useEffectEvent((invoke: ((commentId?: string) => void) | undefined) =>
    props.onInvokeChange?.(invoke),
  );

  useEffect(() => {
    notifyInvoke((commentId) => void invokeRef.current(commentId));

    return () => notifyInvoke(undefined);
  }, []);
  const reply = (id: string, body: string): string | void => {
    const origin = projection.mirrors.get(id)?.commentId ?? id;
    const root = agentCommentRoot(state, origin);
    const replyFocusId = (commentId: string | void): string | void =>
      commentId && projection.mirrors.has(id) ? `${id}:${commentId}` : commentId;

    if (root) {
      const commentId = newAnnotationId();

      pendingWrites.current.push(
        agent.act((client) =>
          client.agentComment({
            id: thread.id,
            comment: {
              ...root,
              id: commentId,
              body,
              sent: false,
              author: undefined,
              replyTo: root.replyTo ?? root.id,
            },
          }),
        ),
      );

      return replyFocusId(commentId);
    }

    return replyFocusId(child?.onReply(origin, body));
  };
  const actionFor = (id: string) => {
    const mirror = projection.mirrors.get(id);
    const submission = state.submissions?.find(
      (entry) => entry.id === mirror?.submissionId || entry.commentId === id,
    );

    if (!submission) return undefined;
    if (submission.status === "failed" && props.client?.canControlAgent !== false)
      return {
        label: "Retry",
        run: () =>
          void agent.act((client) =>
            client.agentPrompt({ id: thread.id, text: "", retry: submission.id }),
          ),
      };

    return {
      label: "View reply",
      run: () => {
        props.onRevealReply?.();
        setRequestedBlock({
          blockIndex: projection.destinations.get(submission.id) ?? projection.tailIndex,
        });
      },
    };
  };

  const notifyActions = useEffectEvent(() => props.onActionsChange?.(actionFor));

  useEffect(() => {
    notifyActions();
  }, [state, projection]);

  return (
    <ThreadView
      {...child}
      session={projection.session}
      display={projection.display}
      marks={projection.marks}
      quickActions={child?.quickActions ?? []}
      observer={false}
      resolved={child?.resolved ?? thread.status !== "pending"}
      suspended={!props.focused || props.suspended}
      theme={theme}
      requestedBlock={requestedBlock}
      isAnnotationReadOnly={(id) =>
        projection.mirrors.has(id) ||
        Boolean(state.submissions?.some((entry) => entry.commentId === id)) ||
        Boolean(state.comments.find((entry) => entry.id === id)?.sent)
      }
      annotationAction={actionFor}
      onInvoke={(commentId) => void invoke(commentId)}
      isPromptBlock={(index) => index === projection.tailIndex}
      promptRestoreRequest={promptRestoreRequest}
      promptFocusRequest={
        continuation.kind === "ready"
          ? { replyId: continuation.replyId, blockIndex: projection.tailIndex }
          : undefined
      }
      canAnnotateBlock={(index) => {
        const source = projection.sources[index];

        return (
          source?.kind !== "activity" &&
          (source?.kind !== "message" ||
            Boolean(
              state.messages.find(
                (entry) => entry.id === source.messageId && entry.role === "agent",
              )?.complete,
            ))
        );
      }}
      onAnnotate={(span, body) => {
        const source = projection.sources[span.start.blockIndex];
        const end = projection.sources[span.end.blockIndex];

        if (source?.kind === "tail") {
          draft.current = body;

          return;
        }
        if (source?.kind === "mirror") {
          const mirrorId = projection.marks.get(span.start.blockIndex)?.[0]?.annotationId;

          if (mirrorId) return reply(mirrorId, body);

          return;
        }
        if (source?.kind === "artifact" && end?.kind === "artifact") {
          return child?.onAnnotate(span, body);
        }
        if (
          source?.kind !== "message" ||
          end?.kind !== "message" ||
          source.messageId !== end.messageId
        )
          return;
        const message = state.messages.find((entry) => entry.id === source.messageId)!;
        const localState = { ...state, messages: [message] };
        const comment = commentOnAgentSpan(
          thread,
          localState,
          {
            start: { ...span.start, blockIndex: source.blockIndex + 1 },
            end: { ...span.end, blockIndex: end.blockIndex + 1 },
          },
          body,
          newAnnotationId(),
        );

        pendingWrites.current.push(
          agent.act((client) => client.agentComment({ id: thread.id, comment })),
        );

        return comment.id;
      }}
      onReply={reply}
      onUpdateAnnotation={(id, body) => {
        const comment = state.comments.find((entry) => entry.id === id);

        if (comment)
          pendingWrites.current.push(
            agent.act((client) =>
              client.agentComment({ id: thread.id, comment: { ...comment, body } }),
            ),
          );
        else child?.onUpdateAnnotation(id, body);
      }}
      onExit={child?.onExit ?? (() => {})}
      renderBlock={(index) =>
        index === projection.activityIndex ? (
          <box style={{ flexDirection: "column", paddingLeft: 2 }}>
            {state.phase.kind === "offline" ? (
              <text fg={theme.textMuted}>Owner offline</text>
            ) : null}
            {state.phase.kind === "failed" ? <text fg={theme.red}>{state.phase.error}</text> : null}
            {busy ? <text fg={pulse ? theme.textDim : theme.textMuted}>Thinking…</text> : null}
            {state.phase.kind === "permission" && props.client?.canControlAgent !== false ? (
              <>
                <text fg={theme.text}>{state.phase.permission.title}</text>
                <box style={{ flexDirection: "row", gap: 2 }}>
                  {state.phase.permission.options.map((option) => (
                    <text
                      key={option.optionId}
                      fg={theme.blue}
                      onMouseUp={() => {
                        if (state.phase.kind === "permission")
                          void agent.act((client) =>
                            client.agentPermission({
                              id: thread.id,
                              requestId:
                                state.phase.kind === "permission" ? state.phase.permission.id : "",
                              optionId: option.optionId,
                            }),
                          );
                      }}
                    >
                      {option.name}
                    </text>
                  ))}
                </box>
              </>
            ) : null}
            {agent.error ? <text fg={theme.red}>{agent.error}</text> : null}
          </box>
        ) : undefined
      }
    />
  );
}

/** The prototype is local and opt-in; shared views keep their existing renderer. */
export function AgentThreadPrototype(
  props: AgentThreadPaneProps & { enabled: boolean; observer: boolean; pixelPrototype: boolean },
): React.ReactNode {
  if (!props.enabled || props.observer || props.pixelPrototype) return props.children;

  return <AgentThreadPane {...props} />;
}

/** Embedded-agent chords apply only while the Thread owns focus. */
export function agentOwnsKeyboard(active: boolean, focusedPane: string): boolean {
  return active && focusedPane === "thread";
}
