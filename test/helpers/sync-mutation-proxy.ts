type TestMutationPhase = ReturnType<typeof Promise.withResolvers<void>>;

interface TestMutationGate {
  received: TestMutationPhase;
  forward: TestMutationPhase;
  processed: TestMutationPhase;
}

export function createTestSyncMutationProxy(authorityURL: string) {
  let pending: TestMutationGate | undefined;
  const active = new Set<TestMutationGate>();
  const server = Bun.serve({
    hostname: "0.0.0.0",
    port: 0,
    async fetch(request) {
      const gate = pending;

      pending = undefined;

      if (gate) active.add(gate);

      try {
        const body = await request.arrayBuffer();

        if (gate) {
          gate.received.resolve();
          await gate.forward.promise;
        }

        const headers = new Headers(request.headers);

        headers.delete("host");
        const target = new URL("/mutate", authorityURL);

        target.search = new URL(request.url).search;
        const response = await fetch(target, {
          method: request.method,
          headers,
          body,
        });

        if (!gate) return response;

        await response.arrayBuffer();

        if (!response.ok)
          throw new Error(`Sync test mutation authority returned HTTP ${response.status}`);

        gate.processed.resolve();

        return new Response("Simulated lost mutation acknowledgement", { status: 503 });
      } catch (cause) {
        gate?.received.reject(cause);
        gate?.processed.reject(cause);

        return new Response("Sync test mutation relay failed", { status: 502 });
      } finally {
        if (gate) active.delete(gate);
      }
    },
  });

  return {
    port: server.port,
    pauseNextMutation() {
      if (pending || active.size)
        throw new Error("Sync test mutation relay already has a paused request");

      const gate: TestMutationGate = {
        received: Promise.withResolvers<void>(),
        forward: Promise.withResolvers<void>(),
        processed: Promise.withResolvers<void>(),
      };

      void gate.received.promise.catch(() => {});
      void gate.processed.promise.catch(() => {});
      pending = gate;

      return {
        received: gate.received.promise,
        processed: gate.processed.promise,
        forward: () => gate.forward.resolve(),
      };
    },
    async close() {
      pending?.forward.resolve();
      for (const gate of active) gate.forward.resolve();
      await server.stop(true);
    },
  };
}
