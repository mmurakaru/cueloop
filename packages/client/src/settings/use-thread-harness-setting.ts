import { useRef, useEffect } from "react";
import { DaemonClient } from "@cueloop/daemon/client";
import type { ThreadAgentState, Thread } from "@cueloop/schema";
import type { ThreadAgentClient } from "../thread/use-thread-agent";
import { persistThreadHarness } from "./config";

interface ThreadHarnessSettingOptions {
  home?: string;
  thread?: Pick<Thread, "id"> | null;
  enabled: boolean;
  owner: boolean;
  state?: ThreadAgentState;
  preferred: "pi" | "fx";
  client?: ThreadAgentClient;
  onState: (state: ThreadAgentState) => void;
  onPreferred: (harness: "pi" | "fx") => void;
  onError: (message: string) => void;
}

/** Preferences apply to new Threads; a bound Thread switches through the owner's daemon. */
export function useThreadHarnessSetting(options: ThreadHarnessSettingOptions) {
  const latest = useRef(options);

  useEffect(() => {
    latest.current = options;
  });
  const threadId = options.thread?.id;
  const current = options.state?.threadId === threadId ? options.state : undefined;
  const selected = current?.handoff?.target ?? current?.harness?.id ?? options.preferred;

  return {
    enabled: options.enabled && options.owner,
    harness: selected === "fx" ? ("fx" as const) : ("pi" as const),
    switchHarness(harness: "pi" | "fx") {
      const request = latest.current;
      const requestedId = request.thread?.id;

      if (!request.enabled || !request.owner) return;

      void (async () => {
        let connection: DaemonClient | undefined;

        try {
          if (requestedId) {
            const api =
              request.client ??
              (connection = await DaemonClient.connect({ home: request.home, autostart: true }));

            if (!api.agentConfigure) throw new Error("Thread harness switching is unavailable");

            const state = await api.agentConfigure({
              id: requestedId,
              configId: "harness",
              value: harness,
            });

            if (latest.current.thread?.id === requestedId) latest.current.onState(state);
          }

          persistThreadHarness(harness);
          latest.current.onPreferred(harness);
        } catch (failure) {
          latest.current.onError(failure instanceof Error ? failure.message : String(failure));
        } finally {
          connection?.close();
        }
      })();
    },
  };
}
