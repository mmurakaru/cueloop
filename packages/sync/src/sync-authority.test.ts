import { expect, test } from "bun:test";
import { createSchema, string, table } from "@rocicorp/zero";
import { createSyncAuthority } from "./sync-authority.ts";

test("unverified credentials cannot reach query or mutation execution", async () => {
  const authority = createSyncAuthority({
    schema: createSchema({ tables: [table("record").columns({ id: string() }).primaryKey("id")] }),
    database: {
      transaction: async () => {
        throw new Error("Unauthenticated database access");
      },
    },
    authenticate: async () => null,
    query: () => {
      throw new Error("Unauthenticated query execution");
    },
    mutate: () => {
      throw new Error("Unauthenticated mutation execution");
    },
  });

  for (const path of ["/query", "/mutate"]) {
    const response = await authority(
      new Request(`http://localhost${path}`, { method: "POST", body: "invalid input" }),
    );

    expect(response.status).toBe(401);
  }
});
