import * as v from "valibot";
import { v7 as createPresenceIdentifier } from "uuid";
import {
  SyncPresenceResponseSchema,
  SyncPresenceUpdateSchema,
  type SyncPresencePeer,
  type SyncPresenceSelection,
} from "./sync-presence-protocol.ts";

export interface SyncPresenceSnapshot {
  readonly status: "connecting" | "connected" | "offline" | "forbidden" | "closed";
  readonly peers: readonly SyncPresencePeer[];
  readonly error?: string;
}

/** A presence client coalesces input into bounded heartbeats and owns no durable storage. */
export function createSyncPresenceClient(options: {
  authorityURL: string;
  workspaceIdentifier: string;
  auth: string;
  pollMilliseconds?: number;
}) {
  const workspaceIdentifier = v.parse(
    v.pipe(v.string(), v.uuid(), v.toLowerCase()),
    options.workspaceIdentifier,
  );
  const pollMilliseconds = v.parse(
    v.pipe(v.number(), v.safeInteger(), v.minValue(500), v.maxValue(5000)),
    options.pollMilliseconds ?? 1000,
  );
  const url = new URL("presence", `${options.authorityURL.replace(/\/$/, "")}/`);
  const connectionIdentifier = createPresenceIdentifier();
  const listeners = new Set<() => void>();
  let snapshot: SyncPresenceSnapshot = { status: "connecting", peers: [] };
  let enabled = true;
  let closed = false;
  let sequence = 0;
  let generation = 0;
  let requestGeneration = 0;
  let typingAt = -Infinity;
  let selection: SyncPresenceSelection | null = null;
  let running: Promise<void> | undefined;
  let activityTimer: ReturnType<typeof setTimeout> | undefined;
  let closing: Promise<void> | undefined;
  let request: AbortController | undefined;
  const publish = (next: SyncPresenceSnapshot) => {
    snapshot = Object.freeze(next);

    for (const listener of listeners) {
      try {
        listener();
      } catch (cause) {
        console.error("Sync presence listener failed", cause);
      }
    }
  };
  const refresh = (): Promise<void> => {
    if (closed || !enabled) return Promise.resolve();

    clearTimeout(activityTimer);
    activityTimer = undefined;

    if (running) {
      const capturedGeneration = requestGeneration;

      return running.then(() => {
        if (generation !== capturedGeneration) return refresh();
      });
    }

    requestGeneration = generation;

    const controller = new AbortController();
    const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(3000)]);
    const currentSequence = ++sequence;
    const currentSelection = selection;
    const typing = performance.now() - typingAt < 3000;

    request = controller;
    running = (async () => {
      try {
        const response = await fetch(url, {
          method: "POST",
          headers: { authorization: `Bearer ${options.auth}`, "content-type": "application/json" },
          body: JSON.stringify({
            action: "publish",
            workspaceIdentifier,
            connectionIdentifier,
            sequence: currentSequence,
            typing,
            selection: currentSelection,
          }),
          signal,
        });

        if (closed || !enabled || signal.aborted) return;

        if (response.status === 401 || response.status === 403) {
          publish({ status: "forbidden", peers: [], error: "Presence access is unavailable" });

          return;
        }

        if (!response.ok)
          throw new Error(`Sync presence authority returned HTTP ${response.status}`);

        const result = v.parse(SyncPresenceResponseSchema, await response.json());

        if (!closed && enabled && !signal.aborted) {
          publish({ status: "connected", peers: result.peers.map((peer) => Object.freeze(peer)) });
        }
      } catch (cause) {
        if (!closed && enabled)
          publish({
            status: "offline",
            peers: [],
            error: cause instanceof Error ? cause.message : "Presence connection failed",
          });
      } finally {
        if (request === controller) request = undefined;
      }
    })();
    const completion = running;

    void completion.finally(() => {
      if (running === completion) running = undefined;
    });

    return completion;
  };
  const timer = setInterval(() => {
    void refresh();
  }, pollMilliseconds);

  void refresh();

  return {
    connectionIdentifier,
    getSnapshot: () => snapshot,
    subscribe(listener: () => void) {
      if (closed) return () => {};

      listeners.add(listener);

      return () => {
        listeners.delete(listener);
      };
    },
    update(update: { typing?: boolean; selection?: SyncPresenceSelection | null }) {
      if (closed) throw new Error("Sync presence client is closed");

      const next = v.parse(SyncPresenceUpdateSchema, update);

      if (next.typing === undefined && next.selection === undefined) return;

      generation++;

      if (next.typing !== undefined) typingAt = next.typing ? performance.now() : -Infinity;

      if (next.selection !== undefined) selection = next.selection;

      if (enabled && !activityTimer) {
        activityTimer = setTimeout(() => {
          activityTimer = undefined;
          void refresh();
        }, 500);
      }
    },
    setEnabled(value: boolean) {
      if (closed || enabled === value) return;

      enabled = value;
      generation++;
      clearTimeout(activityTimer);
      activityTimer = undefined;
      request?.abort();
      typingAt = -Infinity;
      selection = null;
      publish({ status: value ? "connecting" : "offline", peers: [] });
    },
    refresh,
    close(): Promise<void> {
      if (closing) return closing;

      closing = Promise.resolve().then(async () => {
        await running;

        try {
          await fetch(url, {
            method: "POST",
            headers: {
              authorization: `Bearer ${options.auth}`,
              "content-type": "application/json",
            },
            body: JSON.stringify({ action: "leave", workspaceIdentifier, connectionIdentifier }),
            signal: AbortSignal.timeout(3000),
          });
        } catch {
          // The authority lease expires when a closing client cannot reach it.
        }
      });
      closed = true;
      clearInterval(timer);
      clearTimeout(activityTimer);
      activityTimer = undefined;
      request?.abort();
      publish({ status: "closed", peers: [] });
      listeners.clear();

      return closing;
    },
  };
}

export {
  SyncPresenceSelectionSchema,
  type SyncPresenceSelection,
  type SyncPresencePeer,
} from "./sync-presence-protocol.ts";
