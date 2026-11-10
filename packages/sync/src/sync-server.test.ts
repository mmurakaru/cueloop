import { expect, test } from "bun:test";
import { serveSyncApplication } from "./sync-server.ts";

test("the authority host preserves separate response cookies", async () => {
  const server = await serveSyncApplication(
    {
      fetch: () => {
        const headers = new Headers();

        headers.append("Set-Cookie", "session=example; HttpOnly; Path=/");
        headers.append("Set-Cookie", "refresh=example; HttpOnly; Path=/refresh");

        return new Response("ok", { headers });
      },
    },
    { port: 0 },
  );

  try {
    const response = await fetch(`http://127.0.0.1:${server.port}/query`);

    expect(response.headers.getSetCookie()).toEqual([
      "session=example; HttpOnly; Path=/",
      "refresh=example; HttpOnly; Path=/refresh",
    ]);
  } finally {
    await server.close();
  }
});

test("the Fetch request retains its actual HTTP authority", async () => {
  const server = await serveSyncApplication(
    { fetch: (request) => new Response(request.url) },
    { port: 0 },
  );
  const url = `http://127.0.0.1:${server.port}/query?workspace=example`;

  try {
    expect(await (await fetch(url)).text()).toBe(url);
  } finally {
    await server.close();
  }
});

test("a hosted authority can configure its trusted public origin", async () => {
  const server = await serveSyncApplication(
    { fetch: (request) => new Response(request.url) },
    { port: 0, publicOrigin: "https://sync.example.test" },
  );

  try {
    expect(await (await fetch(`http://127.0.0.1:${server.port}/query`)).text()).toBe(
      "https://sync.example.test/query",
    );
  } finally {
    await server.close();
  }
});

test("the authority host rejects oversized requests without executing the application", async () => {
  const server = await serveSyncApplication(
    {
      fetch: () => {
        throw new Error("Oversized input reached the application");
      },
    },
    { port: 0, maximumRequestBytes: 4 },
  );

  try {
    const response = await fetch(`http://127.0.0.1:${server.port}/mutate`, {
      method: "POST",
      body: "abcdef",
    });

    expect(response.status).toBe(413);
  } finally {
    await server.close();
  }
});

test("liveness stays separate from configured authority readiness", async () => {
  let ready = false;
  const server = await serveSyncApplication(
    {
      fetch: () => new Response("application"),
      readiness: () =>
        ready ? { ready: true, phase: "active" } : { ready: false, phase: "fenced" },
    },
    { port: 0 },
  );

  try {
    const health = await fetch(`http://127.0.0.1:${server.port}/health`);
    const fenced = await fetch(`http://127.0.0.1:${server.port}/ready`);

    expect(health.status).toBe(200);
    expect(await health.json()).toMatchObject({ healthy: true, phase: "listening" });
    expect(fenced.status).toBe(503);
    expect(await fenced.json()).toEqual({ ready: false, phase: "fenced" });
    ready = true;
    const active = await fetch(`http://127.0.0.1:${server.port}/ready`);

    expect(active.status).toBe(200);
    expect(await active.json()).toEqual({ ready: true, phase: "active" });
  } finally {
    await server.close();
  }
});

test("missing or failed readiness checks stay unready without exposing their error", async () => {
  const initial = await serveSyncApplication(
    { fetch: () => new Response("application") },
    { port: 0 },
  );
  const failed = await serveSyncApplication(
    {
      fetch: () => new Response("application"),
      readiness: () => {
        throw new Error("private database credentials");
      },
    },
    { port: 0 },
  );

  try {
    expect(await initial.readiness()).toEqual({ ready: false, phase: "initializing" });
    const response = await fetch(`http://127.0.0.1:${failed.port}/ready`);

    expect(response.status).toBe(503);
    expect(await response.text()).toBe(JSON.stringify({ ready: false, phase: "unavailable" }));
  } finally {
    await Promise.all([initial.close(), failed.close()]);
  }
});

test("shutdown rejects new readiness while an admitted request completes before application cleanup", async () => {
  const received = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  let committed = false;
  let cleaned = false;
  const server = await serveSyncApplication(
    {
      fetch: async () => {
        received.resolve();
        await release.promise;
        committed = true;

        return new Response("accepted");
      },
      readiness: () => ({ ready: true, phase: "active" }),
      close: () => {
        expect(committed).toBe(true);
        cleaned = true;
      },
    },
    { port: 0 },
  );
  const request = fetch(`http://127.0.0.1:${server.port}/mutate`, {
    method: "POST",
    body: "change",
  });

  try {
    await received.promise;
    const closing = server.close();

    expect(server.close()).toBe(closing);
    expect(await server.readiness()).toEqual({ ready: false, phase: "closing" });
    expect(cleaned).toBe(false);
    release.resolve();
    expect(await (await request).text()).toBe("accepted");
    await closing;
    expect(cleaned).toBe(true);
    expect(server.liveness()).toMatchObject({ healthy: false, phase: "closed", activeRequests: 0 });
  } finally {
    release.resolve();
    await request.catch(() => {});
    await server.close();
  }
});

test("shutdown aborts an admitted request at its deadline and reports the bounded failure", async () => {
  const received = Promise.withResolvers<void>();
  const cleaned = Promise.withResolvers<void>();
  const server = await serveSyncApplication(
    {
      fetch: async (request) => {
        received.resolve();
        await new Promise<void>((resolve) =>
          request.signal.addEventListener("abort", () => resolve(), { once: true }),
        );

        return new Response("cancelled", { status: 503 });
      },
      close: () => {
        cleaned.resolve();
      },
    },
    { port: 0, shutdownTimeoutMilliseconds: 20 },
  );
  const request = fetch(`http://127.0.0.1:${server.port}/mutate`, {
    method: "POST",
    body: "change",
  }).catch(() => undefined);

  await received.promise;
  await expect(server.close()).rejects.toThrow("shutdown deadline exceeded");
  await cleaned.promise;
  await request;
  expect((await server.readiness()).ready).toBe(false);
});

test("a readiness cancellation can reenter shutdown and receives the same completion", async () => {
  const probing = Promise.withResolvers<void>();
  let nested: Promise<void> | undefined;
  let applicationCloses = 0;
  const server = await serveSyncApplication(
    {
      fetch: () => new Response("application"),
      readiness: (signal) => {
        signal.addEventListener(
          "abort",
          () => {
            nested = server.close();
          },
          { once: true },
        );
        probing.resolve();

        return new Promise(() => {});
      },
      close: () => {
        applicationCloses += 1;
      },
    },
    { port: 0 },
  );
  const readiness = server.readiness();

  await probing.promise;
  const closing = server.close();

  expect(nested).toBe(closing);
  await closing;
  expect(await readiness).toEqual({ ready: false, phase: "closing" });
  expect(applicationCloses).toBe(1);
});
