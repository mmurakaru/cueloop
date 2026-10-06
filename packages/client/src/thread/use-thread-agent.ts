import { useEffect, useRef, useState } from "react";
import { subscribeThreadState, connectThreadObserver } from "@cueloop/daemon/thread-subscription";
import { DaemonClient } from "@cueloop/daemon/client";
import type { ThreadAgentState } from "@cueloop/schema";

/** Agent transport is injectable for frame tests; production uses the daemon socket. */
export type ThreadAgentClient = Pick<
  DaemonClient,
  "agentGet" | "agentPrompt" | "agentCancel" | "agentComment" | "agentPermission"
> &
  Partial<Pick<DaemonClient, "agentConfigure" | "onEvent">> & { canControlAgent?: boolean };

/** Subscribe to durable agent state; unmount closes only this client connection. */
export function useThreadAgent(id: string, home?: string, injected?: ThreadAgentClient) {
  const [client, setClient] = useState<ThreadAgentClient | null>(injected ?? null);
  const [state, setState] = useState<ThreadAgentState>({
    threadId: id,
    phase: { kind: "idle" },
    messages: [],
    tools: [],
    comments: [],
  });
  const revision = useRef(0);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    let connection: DaemonClient | undefined;
    let unsubscribe: (() => void) | undefined;

    revision.current++;
    const refresh = async (api: ThreadAgentClient) => {
      const requested = ++revision.current;
      const result = await api.agentGet(id);

      if (!cancelled && requested === revision.current) setState(result);
    };

    const configure = async (api: ThreadAgentClient): Promise<void> => {
      if (!api.agentConfigure) return;
      const requested = ++revision.current;
      const configured = await api.agentConfigure({ id });

      if (!cancelled && requested === revision.current) setState(configured);
      await refresh(api);
    };

    void (async () => {
      try {
        if (injected) {
          unsubscribe = injected.onEvent?.((event) => {
            if (event.event === "agent.updated" && event.sessionId === id)
              void refresh(injected).catch((error) => {
                if (!cancelled) setError(String(error));
              });
          });
          await refresh(injected);
          await configure(injected);

          return;
        }
        unsubscribe = subscribeThreadState({
          connect: connectThreadObserver({ home, autostart: true }),
          matches: (event) => event.event === "agent.updated" && event.sessionId === id,
          read: async (api, signal) => {
            const requested = ++revision.current;
            const state = await api.agentGet(id, { signal });

            return { state, requested };
          },
          onConnect: (api) => {
            connection = api;
            setClient(api);
            void configure(api).catch((error) => {
              if (!cancelled) setError(String(error));
            });
          },
          onValue: ({ state, requested }) => {
            if (!cancelled && requested === revision.current) setState(state);
          },
          onError: (error) => {
            if (!cancelled) setError(String(error));
          },
        });
      } catch (error) {
        if (!cancelled) setError(error instanceof Error ? error.message : String(error));
      }
    })();

    return () => {
      cancelled = true;
      unsubscribe?.();
      connection?.close();
    };
  }, [id, home, injected]);

  const act = async (
    request: (client: ThreadAgentClient) => Promise<ThreadAgentState>,
  ): Promise<boolean> => {
    if (!client) return false;
    try {
      const requested = ++revision.current;
      const result = await request(client);

      if (requested === revision.current) setState(result);
      setError("");

      return true;
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error));

      return false;
    }
  };

  return { state, client, error, setError, act };
}
