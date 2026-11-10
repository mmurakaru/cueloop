import { SpanKind } from "@opentelemetry/api";
import { getSyncTelemetry, type SyncTelemetry } from "./sync-telemetry.ts";
import { attemptSyncTelemetry } from "./sync-telemetry-context.ts";
import { syncAuthorityStorageKey } from "./sync-authority-client.ts";
import type { SyncAuthorityIdentity, SyncWorkspaceAuthority } from "./sync-authority-protocol.ts";
import {
  Zero,
  type MutateRequest,
  type ReadonlyJSONValue,
  type Schema,
  type ZeroOptions,
  type Connection,
  type MutatorResult,
  type StorageFailureError,
} from "@rocicorp/zero";

export type SyncClientLifecycle =
  | { status: "active" }
  | { status: "needs-reset"; reason: "client-state-missing" | "application-changed" }
  | { status: "storage-failed"; kind: StorageFailureError["kind"] }
  | { status: "closing" }
  | { status: "closed" };

export interface SyncClientLifecycleSource {
  readonly current: SyncClientLifecycle;
  subscribe(listener: (state: SyncClientLifecycle) => void): () => void;
}

export interface SyncClient<ApplicationSchema extends Schema, Context> {
  readonly telemetry?: SyncTelemetry;
  connection: Connection;
  lifecycle: SyncClientLifecycleSource;
  materialize: Zero<ApplicationSchema, undefined, Context>["materialize"];
  run: Zero<ApplicationSchema, undefined, Context>["run"];
  mutate<Arguments extends ReadonlyJSONValue | undefined, WrappedTransaction>(
    request: MutateRequest<Arguments, ApplicationSchema, Context, WrappedTransaction>,
  ): MutatorResult;
  close: () => Promise<void>;
}

export function createSyncClient<const ApplicationSchema extends Schema, Context = unknown>(
  options: ZeroOptions<ApplicationSchema, undefined, Context> & {
    authority?: SyncAuthorityIdentity | SyncWorkspaceAuthority;
    telemetry?: SyncTelemetry;
  },
): SyncClient<ApplicationSchema, Context> {
  if (options.cacheURL !== null && options.kvStore !== "mem" && !options.authority)
    throw new Error(
      "Sync persistent client requires a resolved authority before opening its replica",
    );

  const { telemetry = getSyncTelemetry(), ...clientOptions } = options;
  const pendingTelemetry = new Set<ReturnType<SyncTelemetry["start"]>>();
  let lifecycleState: SyncClientLifecycle = { status: "active" };
  let closing: Promise<void> | undefined;
  const lifecycleListeners = new Set<(state: SyncClientLifecycle) => void>();
  const publishLifecycle = (state: SyncClientLifecycle) => {
    if (
      lifecycleState.status === "closed" ||
      (lifecycleState.status === "closing" && state.status !== "closed")
    )
      return;

    lifecycleState = state;
    const outcomes = {
      active: "started",
      "needs-reset": "recovery-required",
      "storage-failed": "failed",
      closing: "closing",
      closed: "closed",
    } as const;

    telemetry.event("client.lifecycle", outcomes[state.status]);

    for (const listener of lifecycleListeners) {
      try {
        listener(state);
      } catch (cause) {
        console.error("Sync lifecycle listener failed", cause);
      }
    }
  };
  const client = new Zero({
    ...clientOptions,
    getTraceparent() {
      const suppliedTraceparent = clientOptions.getTraceparent;

      if (suppliedTraceparent) return attemptSyncTelemetry(() => suppliedTraceparent());

      const pending = [...pendingTelemetry];
      const transport = telemetry.start("transport.send", {
        kind: SpanKind.CLIENT,
        parent: pending[0]?.context,
        links: pending.flatMap((span) => (span.spanContext ? [span.spanContext] : [])),
      });
      const parent = telemetry.traceparent(transport.context);

      transport.end();

      return parent;
    },
    storageKey: options.authority
      ? syncAuthorityStorageKey(options.authority, options.storageKey)
      : options.storageKey,
    onClientStateNotFound() {
      publishLifecycle({ status: "needs-reset", reason: "client-state-missing" });
      options.onClientStateNotFound?.();
    },
    onUpdateNeeded(reason) {
      publishLifecycle({ status: "needs-reset", reason: "application-changed" });
      options.onUpdateNeeded?.(reason);
    },
    onStorageFailure(failure) {
      publishLifecycle({ status: "storage-failed", kind: failure.kind });
      options.onStorageFailure?.(failure);
    },
  });

  telemetry.activeWork("client.lifecycle", 1);
  let previousConnection = client.connection.state.current.name;
  const unsubscribeConnection = client.connection.state.subscribe(() => {
    const name = client.connection.state.current.name;

    if (name === previousConnection) return;

    previousConnection = name;
    telemetry.event("client.lifecycle", name === "connected" ? "connected" : "disconnected");
  });

  return {
    telemetry,
    connection: client.connection,
    lifecycle: {
      get current() {
        return lifecycleState;
      },
      subscribe(listener) {
        lifecycleListeners.add(listener);

        try {
          listener(lifecycleState);
        } catch (cause) {
          lifecycleListeners.delete(listener);

          throw cause;
        }

        return () => lifecycleListeners.delete(listener);
      },
    },
    materialize: client.materialize.bind(client),
    run: client.run.bind(client),
    mutate<Arguments extends ReadonlyJSONValue | undefined, WrappedTransaction>(
      request: MutateRequest<Arguments, ApplicationSchema, Context, WrappedTransaction>,
    ) {
      if (lifecycleState.status !== "active") {
        throw new Error(
          "Sync client requires replacement before submitting changes; retain the change as a draft",
        );
      }

      if (client.connection.state.current.name !== "connected") {
        throw new Error(
          "Sync mutation requires a connected authority; retain the change as a draft",
        );
      }

      const observation = telemetry.start("mutation.submit", { kind: SpanKind.CLIENT });

      if (pendingTelemetry.size < 32) pendingTelemetry.add(observation);

      try {
        const result = observation.run(() => client.mutate(request));

        return {
          ...result,
          server: result.server.then(
            (outcome) => {
              pendingTelemetry.delete(observation);
              observation.end(outcome.type === "success" ? "completed" : "failed");

              return outcome;
            },
            (cause) => {
              pendingTelemetry.delete(observation);
              observation.end("failed");

              throw cause;
            },
          ),
        };
      } catch (cause) {
        pendingTelemetry.delete(observation);
        observation.end("failed");

        throw cause;
      }
    },
    close() {
      if (closing) return closing;

      const completion = Promise.withResolvers<void>();

      closing = completion.promise;
      publishLifecycle({ status: "closing" });
      unsubscribeConnection();

      for (const observation of pendingTelemetry) observation.end("pending");

      pendingTelemetry.clear();
      const finish = async () => {
        try {
          // Startup can create a broadcast channel after an early close.
          await client.clientGroupID;
        } finally {
          try {
            await client.close();
          } finally {
            publishLifecycle({ status: "closed" });
            telemetry.activeWork("client.lifecycle", -1);
            lifecycleListeners.clear();
          }
        }
      };

      void finish().then(completion.resolve, completion.reject);

      return closing;
    },
  };
}
