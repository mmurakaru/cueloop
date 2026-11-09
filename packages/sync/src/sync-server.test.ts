import { expect, test } from "bun:test";
import { serveSyncApplication } from "./sync-server.ts";

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
