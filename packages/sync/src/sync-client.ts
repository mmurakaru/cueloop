import {
  Zero,
  type MutateRequest,
  type ReadonlyJSONValue,
  type Schema,
  type ZeroOptions,
  type Connection,
  type MutatorResult,
} from "@rocicorp/zero";

export interface SyncClient<ApplicationSchema extends Schema, Context> {
  connection: Connection;
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
  const client = new Zero(options);

  return {
    connection: client.connection,
    materialize: client.materialize.bind(client),
    run: client.run.bind(client),
    mutate<Arguments extends ReadonlyJSONValue | undefined, WrappedTransaction>(
      request: MutateRequest<Arguments, ApplicationSchema, Context, WrappedTransaction>,
    ) {
      if (client.connection.state.current.name !== "connected") {
        throw new Error(
          "Sync mutation requires a connected authority; retain the change as a draft",
        );
      }

      return client.mutate(request);
    },
    async close() {
      try {
        // Startup can create a broadcast channel after an early close.
        await client.clientGroupID;
      } finally {
        await client.close();
      }
    },
  };
}
