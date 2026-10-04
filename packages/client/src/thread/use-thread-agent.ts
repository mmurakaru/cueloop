import { useEffect, useState } from "react";
import { DaemonClient } from "@cueloop/daemon/client";
import type { ThreadAgentState } from "@cueloop/schema";

/** Agent transport is injectable for frame tests; production uses the daemon socket. */
export type ThreadAgentClient = Pick<
  DaemonClient,
  "agentGet" | "agentPrompt" | "agentCancel" | "agentComment" | "agentPermission"
>;

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
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    let connection: DaemonClient | undefined;
    let unsubscribe: (() => void) | undefined;
    let revision = 0;
    const refresh = async (api: ThreadAgentClient) => {
      const requested = ++revision;
      const result = await api.agentGet(id);

      if (!cancelled && requested === revision) setState(result);
    };

    void (async () => {
      try {
        if (injected) {
          await refresh(injected);

          return;
        }
        connection = await DaemonClient.connect({ home, autostart: true });
        if (cancelled) {
          connection.close();
          return;
        }
        setClient(connection);
        unsubscribe = connection.onEvent((event) => {
          if (event.event === "agent.updated" && event.sessionId === id)
            void refresh(connection!).catch((error) => {
              if (!cancelled) setError(String(error));
            });
        });
        await connection.subscribe();
        await refresh(connection);
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
      const result = await request(client);

      setState(result);
      setError("");

      return true;
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error));

      return false;
    }
  };

  return { state, client, error, setError, act };
}
