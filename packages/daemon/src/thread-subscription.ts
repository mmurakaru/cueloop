import { DaemonClient, DaemonClientError, type ConnectOptions } from "./client";
import { DaemonTransportError } from "./client-errors";
import type { EventFrame } from "./protocol";

/* eslint-disable type-evidence/no-unknown-parameters -- Socket and read failures arrive from an untyped Promise rejection boundary. */
/** Notifications are refresh hints; each connection starts with an authoritative read. */
export interface ThreadSubscriptionOptions<Value> {
  connect: () => Promise<DaemonClient>;
  matches: (event: EventFrame) => boolean;
  read: (client: DaemonClient, signal: AbortSignal) => Promise<Value>;
  onValue: (value: Value, client: DaemonClient) => void;
  onError: (error: unknown) => void;
  onConnect?: (client: DaemonClient) => void;
  reconnectMs?: number;
}
/* eslint-enable type-evidence/no-unknown-parameters */

/** Dispose removes listeners, aborts local reads, and closes only the observation connection. */
export function subscribeThreadState<Value>(options: ThreadSubscriptionOptions<Value>): () => void {
  let stopped = false;
  let generation = 0;
  let connection: DaemonClient | undefined;
  let detach: (() => void) | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const reads = new Set<AbortController>();
  const schedule = () => {
    if (!stopped) timer = setTimeout(() => void connect(), options.reconnectMs ?? 250);
  };
  const connect = async () => {
    const epoch = ++generation;
    let request = 0;
    let api: DaemonClient | undefined;

    try {
      api = await options.connect();
      if (stopped || epoch !== generation) {
        api.close();

        return;
      }
      connection = api;
      const current = api;
      const refresh = async () => {
        const version = ++request;

        for (const read of reads) read.abort();
        const controller = new AbortController();

        reads.add(controller);
        try {
          const value = await options.read(current, controller.signal);

          if (!stopped && epoch === generation && version === request)
            options.onValue(value, current);
        } catch (error) {
          if (!stopped && epoch === generation && version === request) {
            if (error instanceof Error && isFatalSubscriptionError(error)) {
              stopped = true;
              ++generation;
              clearTimeout(timer);
              detach?.();
              current.close();
            }
            options.onError(error);
          }
        } finally {
          reads.delete(controller);
        }
      };
      const offEvent = api.onEvent((event) => {
        if (options.matches(event)) void refresh();
      });
      const offDisconnect = api.onDisconnect((reason) => {
        if (stopped || epoch !== generation) return;
        ++generation;
        detach?.();
        for (const read of reads) read.abort();
        connection = undefined;
        current.close();
        if (isFatalSubscriptionError(reason)) {
          stopped = true;
          options.onError(reason);
        } else schedule();
      });

      detach = () => {
        offEvent();
        offDisconnect();
      };
      await api.subscribe();
      if (stopped || epoch !== generation) return;
      options.onConnect?.(api);
      await refresh();
    } catch (error) {
      if (stopped || epoch !== generation) return;
      ++generation;
      detach?.();
      api?.close();
      connection = undefined;
      options.onError(error);
      if (!(error instanceof Error && isFatalSubscriptionError(error))) schedule();
    }
  };

  void connect();

  return () => {
    stopped = true;
    ++generation;
    clearTimeout(timer);
    detach?.();
    for (const read of reads) read.abort();
    reads.clear();
    connection?.close();
  };
}

/** Reconnect never replays writes, only subscribes and reads the latest Thread state. */
export function connectThreadObserver(options: ConnectOptions): () => Promise<DaemonClient> {
  return () => DaemonClient.connect(options);
}

function isFatalSubscriptionError(error: Error): boolean {
  return (
    error instanceof DaemonClientError ||
    (error instanceof DaemonTransportError && error.kind === "protocol")
  );
}
