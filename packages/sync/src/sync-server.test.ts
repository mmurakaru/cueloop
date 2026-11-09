import { expect, test } from "bun:test";
import { serveSyncApplication } from "./sync-server.ts";

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
