import React, { useEffect, useMemo, useRef, useState } from "react";
import { useKeyboard } from "@opentui/react";
import type { TextareaRenderable } from "@opentui/core";
import { newAnnotationId, type Thread, type AgentTool } from "@cueloop/schema";
import type { Theme } from "../../appearance/theme";
import { ThreadView } from "../../markdown/components/ThreadView";
import { projectAgentTranscript, commentOnAgentSpan } from "../agent-transcript";
import { useThreadAgent, type ThreadAgentClient } from "../use-thread-agent";
import type { DisplayBlock } from "../../markdown/view-plan";

/** The opt-in agent surface keeps the artifact accessible while its transcript streams. */
export interface AgentThreadPaneProps {
  thread: Thread;
  home?: string;
  theme: Theme;
  children: React.ReactNode;
  passage?: string;
  focused: boolean;
  suspended?: boolean;
  onActiveChange: (active: boolean) => void;
  onOpenFile: (path: string) => void;
  onNextPane?: (backward: boolean) => void;
  client?: ThreadAgentClient;
}

/** Render agent messages through the existing selection and inline annotation surface. */
export function AgentThreadPane(props: AgentThreadPaneProps): React.ReactNode {
  const { thread, theme } = props;
  const { focused, onActiveChange } = props;
  const agent = useThreadAgent(thread.id, props.home, props.client);
  const [conversation, setConversation] = useState(true);
  const [typing, setTyping] = useState(true);
  const [annotating, setAnnotating] = useState(false);
  const [text, setText] = useState("");
  const [context, setContext] = useState<string | undefined>();
  const [details, setDetails] = useState(false);
  const input = useRef<TextareaRenderable | null>(null);
  const state = agent.state;
  const projection = useMemo(() => projectAgentTranscript(thread, state), [thread, state]);
  const busy = state.phase.kind === "running" || state.phase.kind === "permission";
  const permission = state.phase.kind === "permission" ? state.phase.permission : undefined;
  const pending = state.comments.filter((comment) => !comment.sent).length;

  useEffect(() => {
    onActiveChange(conversation);

    return () => onActiveChange(false);
  }, [conversation, onActiveChange]);
  useEffect(() => {
    if (typing && conversation && props.focused && !props.suspended) input.current?.focus();
  }, [typing, conversation, props.focused, props.suspended]);
  useKeyboard((key) => {
    if (!conversation || !props.focused || props.suspended || annotating) return;
    if (key.name === "escape" && typing) {
      key.preventDefault();
      setTyping(false);
      input.current?.blur();
    } else if (!typing && key.name === "i" && !key.ctrl && !key.meta) {
      key.preventDefault();
      setTyping(true);
    } else if (!typing && key.name === "tab") {
      key.preventDefault();
      props.onNextPane?.(Boolean(key.shift));
    }
  });

  const send = async () => {
    if (busy || (!text.trim() && !pending)) return;
    const sent = await agent.act((client) => client.agentPrompt({ id: thread.id, text, context }));

    if (sent) {
      setText("");
      input.current?.setText("");
      setContext(undefined);
      setTyping(false);
      input.current?.blur();
    }
  };

  return (
    <box style={{ flexGrow: 1, flexDirection: "column" }}>
      <box style={{ height: 1, flexDirection: "row", gap: 2, paddingLeft: 1 }}>
        <text
          fg={!conversation ? theme.accent : theme.textDim}
          onMouseUp={() => setConversation(false)}
        >
          Artifact
        </text>
        <text
          fg={conversation ? theme.accent : theme.textDim}
          onMouseUp={() => setConversation(true)}
        >
          Agent
        </text>
        <text fg={theme.textDim}>{busy ? "fx working" : "fx ready"}</text>
        <text
          fg={theme.blue}
          onMouseUp={() => setDetails((value) => !value)}
        >{`Tools (${state.tools.length})`}</text>
        {busy ? (
          <text
            fg={theme.red}
            onMouseUp={() => void agent.act((client) => client.agentCancel(thread.id))}
          >
            Stop
          </text>
        ) : null}
        {!conversation && props.passage ? (
          <text
            fg={theme.blue}
            onMouseUp={() => {
              setContext(props.passage);
              setConversation(true);
              setTyping(true);
            }}
          >
            Ask about passage
          </text>
        ) : null}
      </box>
      {conversation ? (
        <>
          <text
            fg={theme.textDim}
            style={{ paddingLeft: 1 }}
          >{`Workspace: ${thread.artifact.meta.cwd ?? thread.workspace.repoRoot}`}</text>
          {details ? (
            <AgentToolDetails
              tools={state.tools}
              thread={thread}
              theme={theme}
              onOpenFile={props.onOpenFile}
            />
          ) : null}
          {projection.display.length ? (
            <ThreadView
              session={projection.session}
              display={projection.display}
              marks={projection.marks}
              quickActions={[]}
              observer={false}
              suspended={typing || !props.focused || props.suspended}
              onComposingChange={setAnnotating}
              canAnnotateBlock={(index) => {
                const source = projection.sources[index];
                const message = state.messages.find((message) => message.id === source?.messageId);

                return message?.role === "agent" && message.complete;
              }}
              onAnnotate={(span, body) => {
                try {
                  const comment = commentOnAgentSpan(thread, state, span, body, newAnnotationId());

                  void agent.act((client) => client.agentComment({ id: thread.id, comment }));
                } catch (error) {
                  agent.setError(String(error));
                }
              }}
              onReply={(commentId, body) => {
                const root = state.comments.find((comment) => comment.id === commentId);

                if (root)
                  void agent.act((client) =>
                    client.agentComment({
                      id: thread.id,
                      comment: {
                        ...root,
                        id: newAnnotationId(),
                        replyTo: root.replyTo ?? root.id,
                        body,
                        sent: false,
                      },
                    }),
                  );
              }}
              onUpdateAnnotation={(id, body) => {
                const comment = state.comments.find((comment) => comment.id === id);

                if (comment)
                  void agent.act((client) =>
                    client.agentComment({ id: thread.id, comment: { ...comment, body } }),
                  );
              }}
              onExit={() => setTyping(true)}
            />
          ) : (
            <box style={{ flexGrow: 1, padding: 2 }}>
              <text fg={theme.textMuted}>
                Ask about this Thread. Completed answers accept comments.
              </text>
            </box>
          )}
          {permission ? (
            <box
              style={{
                height: 4,
                flexShrink: 0,
                flexDirection: "column",
                paddingLeft: 1,
                border: true,
                borderColor: theme.accent,
              }}
            >
              <text fg={theme.text}>{permission.title}</text>
              <box style={{ flexDirection: "row", gap: 2 }}>
                {permission.options.map((option) => (
                  <text
                    key={option.optionId}
                    fg={theme.blue}
                    onMouseUp={() => {
                      void agent.act((client) =>
                        client.agentPermission({
                          id: thread.id,
                          requestId: permission.id,
                          optionId: option.optionId,
                        }),
                      );
                    }}
                  >
                    {option.name}
                  </text>
                ))}
              </box>
            </box>
          ) : null}
          <AgentComposer
            error={agent.error || (state.phase.kind === "failed" ? state.phase.error : "")}
            context={context}
            busy={busy}
            pending={pending}
            typing={typing}
            focused={focused}
            suspended={props.suspended}
            input={input}
            setText={setText}
            setTyping={setTyping}
            send={send}
            theme={theme}
          />
        </>
      ) : (
        props.children
      )}
    </box>
  );
}

/** Keep the prototype opt-in and unavailable in shared or observer views. */
export function AgentThreadPrototype(
  props: AgentThreadPaneProps & { enabled: boolean; observer: boolean; pixelPrototype: boolean },
): React.ReactNode {
  if (
    !props.enabled ||
    props.observer ||
    props.pixelPrototype ||
    process.env.CUELOOP_FX_THREAD !== "1"
  )
    return props.children;

  return <AgentThreadPane {...props} />;
}

/** Include the caret's artifact block as explicit context for an agent question. */
export function agentPassageFromBlock(block?: DisplayBlock): string | undefined {
  return (block?.work ?? block?.base)?.text;
}

/** Artifact review controls remain available only when its surface is visible. */
export function AgentArtifactChrome({
  active,
  children,
}: {
  active: boolean;
  children: React.ReactNode;
}): React.ReactNode {
  return active ? null : children;
}

function AgentToolDetails({
  tools,
  thread,
  theme,
  onOpenFile,
}: {
  tools: AgentTool[];
  thread: Thread;
  theme: Theme;
  onOpenFile: (path: string) => void;
}): React.ReactNode {
  return (
    <scrollbox style={{ height: 8 }}>
      {tools.map((tool) => (
        <box key={`${tool.turnId}-${tool.id}`} style={{ flexDirection: "column", paddingLeft: 1 }}>
          <text
            fg={tool.status === "failed" ? theme.red : theme.textMuted}
          >{`${tool.status} · ${tool.title}`}</text>
          {tool.output ? <text fg={theme.textDim}>{tool.output}</text> : null}
          {tool.locations.map((location) => (
            <text
              key={location.path}
              fg={theme.blue}
              onMouseUp={() => {
                const root = thread.artifact.meta.cwd ?? thread.workspace.repoRoot;
                const path = location.path.startsWith(root + "/")
                  ? location.path.slice(root.length + 1)
                  : location.path;

                if (!path.startsWith("/")) onOpenFile(path);
              }}
            >{`Open ${location.path}${location.line === undefined ? "" : `:${location.line}`}`}</text>
          ))}
        </box>
      ))}
    </scrollbox>
  );
}

interface AgentComposerProps {
  error: string;
  context?: string;
  busy: boolean;
  pending: number;
  typing: boolean;
  focused: boolean;
  suspended?: boolean;
  input: React.RefObject<TextareaRenderable | null>;
  setText: (text: string) => void;
  setTyping: (typing: boolean) => void;
  send: () => Promise<void>;
  theme: Theme;
}

function AgentComposer({
  error,
  context,
  busy,
  pending,
  typing,
  focused,
  suspended,
  input,
  setText,
  setTyping,
  send,
  theme,
}: AgentComposerProps): React.ReactNode {
  return (
    <>
      {error ? <text fg={theme.red}>{error}</text> : null}
      {context ? <text fg={theme.textMuted}>{`Passage: ${context.slice(0, 120)}`}</text> : null}
      <box
        style={{
          height: 4,
          flexDirection: "column",
          border: ["top"],
          borderColor: theme.border,
          paddingLeft: 1,
        }}
        onMouseUp={() => setTyping(true)}
      >
        <textarea
          ref={input}
          focused={typing && focused && !suspended}
          placeholder={
            busy
              ? "Wait for fx, or stop the turn"
              : "Ask fx…  Ctrl+Enter sends · Esc reads · i composes"
          }
          keyBindings={[
            { name: "return", ctrl: true, action: "submit" },
            { name: "return", super: true, action: "submit" },
          ]}
          onSubmit={() => void send()}
          onContentChange={() => setText(input.current?.plainText ?? "")}
          style={{
            height: 2,
            backgroundColor: theme.panel,
            textColor: theme.text,
            focusedTextColor: theme.text,
          }}
        />
        <text
          fg={busy ? theme.textDim : theme.accent}
          onMouseUp={() => void send()}
        >{`Send message (${pending})`}</text>
      </box>
    </>
  );
}

/** Route pane navigation only while the agent conversation owns Thread focus. */
export function agentOwnsKeyboard(active: boolean, focusedPane: string): boolean {
  return active && focusedPane === "thread";
}
