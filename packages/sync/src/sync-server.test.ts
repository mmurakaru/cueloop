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
