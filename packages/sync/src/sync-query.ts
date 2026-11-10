import { getSyncTelemetry, type SyncTelemetry } from "./sync-telemetry.ts";
import type { Connection, ResultType, TypedView } from "@rocicorp/zero";
import * as v from "valibot";
import type { SyncClientLifecycle, SyncClientLifecycleSource } from "./sync-client.ts";

interface SyncQueryClient {
  readonly telemetry?: SyncTelemetry;
  connection: Connection;
  lifecycle: SyncClientLifecycleSource;
}

export interface SyncQuerySnapshot<Data> {
  data: Data;
  freshness: ResultType;
  connection: Connection["state"]["current"]["name"];
  lifecycle: SyncClientLifecycle;
}

/** A query subscription owns its view and coalesces slow consumers into one bounded full snapshot. */
export function createSyncQuerySubscription<Data>(options: {
  client: SyncQueryClient;
  view: TypedView<Data>;
  maximumBytes?: number;
  signal?: AbortSignal;
  telemetry?: SyncTelemetry;
}) {
  const maximumBytes = v.parse(
    v.pipe(v.number(), v.safeInteger(), v.minValue(1), v.maxValue(64 * 1024 * 1024)),
    options.maximumBytes ?? 8 * 1024 * 1024,
  );
  const telemetry = options.telemetry ?? options.client.telemetry ?? getSyncTelemetry();

  telemetry.activeWork("query.subscription", 1);
  telemetry.event("query.subscription", "started");
  let previousState: string | undefined;
  let previouslyComplete = false;
  let staleSince = performance.now();
  let changed = Promise.withResolvers<void>();
  const completion = new AbortController();
  let pending: SyncQuerySnapshot<Data> | undefined;
  let freshness: ResultType = "unknown";
  let failure: Error | undefined;
  let stopped = false;
  let viewDestroyed = false;
  let unsubscribeView: (() => void) | undefined;
  let unsubscribeConnection: (() => void) | undefined;
  let unsubscribeLifecycle: (() => void) | undefined;
  const close = () => {
    if (stopped) return;

    stopped = true;
    telemetry.activeWork("query.subscription", -1);
    telemetry.event("query.subscription", "closed");
    pending = undefined;
    unsubscribeView?.();
    unsubscribeConnection?.();
    unsubscribeLifecycle?.();
    options.signal?.removeEventListener("abort", close);

    if (!viewDestroyed) {
      viewDestroyed = true;
      options.view.destroy();
    }

    changed.resolve();
    completion.abort(failure);
  };
  const fail = (cause: Error) => {
    if (stopped) return;

    failure = cause;
    close();
  };
  const publish = () => {
    if (stopped) return;

    try {
      const snapshot = {
        data: options.view.data,
        freshness,
        connection: options.client.connection.state.current.name,
        lifecycle: options.client.lifecycle.current,
      };
      const serialized = JSON.stringify(snapshot);
      const bytes = new TextEncoder().encode(serialized).byteLength;
      const state = `${snapshot.freshness}:${snapshot.connection}:${snapshot.lifecycle.status}`;

      if (state !== previousState) {
        const complete =
          snapshot.freshness === "complete" &&
          snapshot.connection === "connected" &&
          snapshot.lifecycle.status === "active";

        if (!complete && previouslyComplete) staleSince = performance.now();

        telemetry.event("query.subscription", complete ? "complete" : "stale", {
          bytes,
          ageSeconds: complete ? (performance.now() - staleSince) / 1000 : 0,
        });

        previouslyComplete = complete;
        previousState = state;
      }

      if (bytes > maximumBytes) {
        telemetry.event("query.subscription", "overflow", { bytes });
        fail(
          new Error(
            "Sync query snapshot exceeds its byte budget; reduce the query or increase the budget",
          ),
        );

        return;
      }

      pending = { ...snapshot, data: structuredClone(snapshot.data) };
      changed.resolve();
    } catch (cause) {
      fail(cause instanceof Error ? cause : new Error("Sync query snapshot cannot be serialized"));
    }
  };

  try {
    unsubscribeView = options.view.addListener((_data, nextFreshness, error) => {
      if (stopped) return;

      if (nextFreshness === "error") {
        fail(new Error(`Sync query failed: ${error?.message ?? "Unknown query error"}`));

        return;
      }

      freshness = nextFreshness;
      publish();
    });

    if (stopped) unsubscribeView?.();

    if (!stopped) unsubscribeConnection = options.client.connection.state.subscribe(publish);

    if (!stopped)
      unsubscribeLifecycle = options.client.lifecycle.subscribe((state) => {
        if (state.status === "closing" || state.status === "closed") close();
        else publish();
      });

    if (!stopped) options.signal?.addEventListener("abort", close, { once: true });

    if (stopped || options.signal?.aborted) close();
  } catch (cause) {
    try {
      close();
    } catch {}

    throw cause;
  }

  async function* snapshots(): AsyncGenerator<SyncQuerySnapshot<Data>> {
    try {
      for (;;) {
        if (failure) throw failure;

        if (stopped) return;

        if (pending) {
          const snapshot = pending;

          pending = undefined;
          yield snapshot;
          continue;
        }

        await changed.promise;
        changed = Promise.withResolvers<void>();
      }
    } finally {
      close();
    }
  }

  return Object.assign(snapshots(), { close, signal: completion.signal });
}
