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
  options: ZeroOptions<ApplicationSchema, undefined, Context>,
): SyncClient<ApplicationSchema, Context> {
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

    for (const listener of lifecycleListeners) {
      try {
        listener(state);
      } catch (cause) {
        console.error("Sync lifecycle listener failed", cause);
      }
    }
  };
  const client = new Zero({
    ...options,
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

  return {
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

      return client.mutate(request);
    },
    close() {
      if (closing) return closing;

      const completion = Promise.withResolvers<void>();

      closing = completion.promise;
      publishLifecycle({ status: "closing" });
      const finish = async () => {
        try {
          // Startup can create a broadcast channel after an early close.
          await client.clientGroupID;
        } finally {
          try {
            await client.close();
          } finally {
            publishLifecycle({ status: "closed" });
            lifecycleListeners.clear();
          }
        }
      };

      void finish().then(completion.resolve, completion.reject);

      return closing;
    },
  };
}
