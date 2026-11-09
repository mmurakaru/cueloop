import { expect, test } from "bun:test";
import { createSyncPresenceAuthority } from "./sync-presence-authority.ts";
import { createSyncPresenceClient } from "./sync-presence-client.ts";

const WORKSPACE = "019a6819-bf85-7000-8000-000000000001";

test("independent presence clients recover after suspension and remove only their own connection", async () => {
  const members = new Set(["alice", "bob"]);
  const authority = createSyncPresenceAuthority({
    authenticate: async (request) => ({
      actorIdentifier: request.headers.get("authorization")?.replace("Bearer ", "") ?? "",
    }),
    authorize: async (access) => access.actorIdentifiers.filter((actor) => members.has(actor)),
  });
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: authority.fetch });
  const first = createSyncPresenceClient({
    authorityURL: server.url.href,
    workspaceIdentifier: WORKSPACE,
    auth: "alice",
  });
  const second = createSyncPresenceClient({
    authorityURL: server.url.href,
    workspaceIdentifier: WORKSPACE,
    auth: "bob",
  });

  try {
    await first.refresh();
    second.update({ typing: true });
    await second.refresh();
    await first.refresh();
    expect(
      first
        .getSnapshot()
        .peers.toSorted((left, right) => left.actorIdentifier.localeCompare(right.actorIdentifier))
        .map((peer) => [peer.actorIdentifier, peer.typing]),
    ).toEqual([
      ["alice", false],
      ["bob", true],
    ]);
    second.setEnabled(false);
    expect(second.getSnapshot()).toMatchObject({ status: "offline", peers: [] });
    second.setEnabled(true);
    await second.refresh();
    expect(second.getSnapshot().status).toBe("connected");
    await second.close();
    await first.refresh();
    expect(first.getSnapshot().peers.map((peer) => peer.actorIdentifier)).toEqual(["alice"]);
    members.delete("alice");
    await first.refresh();
    expect(first.getSnapshot()).toMatchObject({ status: "forbidden", peers: [] });
  } finally {
    await first.close();
    await second.close();
    authority.close();
    await server.stop(true);
  }
});

test("a lost presence authority clears cached activity and recovers after an empty restart", async () => {
  const options = {
    authenticate: async () => ({ actorIdentifier: "alice" }),
    authorize: async (access: { actorIdentifiers: readonly string[] }) => access.actorIdentifiers,
  };
  let authority = createSyncPresenceAuthority(options);
  let online = true;
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch: (request) =>
      online ? authority.fetch(request) : new Response("Unavailable", { status: 503 }),
  });
  const client = createSyncPresenceClient({
    authorityURL: server.url.href,
    workspaceIdentifier: WORKSPACE,
    auth: "alice",
  });

  try {
    await client.refresh();
    expect(client.getSnapshot().peers).toHaveLength(1);
    online = false;
    await client.refresh();
    expect(client.getSnapshot()).toMatchObject({ status: "offline", peers: [] });
    authority.close();
    authority = createSyncPresenceAuthority(options);
    online = true;
    await client.refresh();
    expect(client.getSnapshot()).toMatchObject({
      status: "connected",
      peers: [{ connectionIdentifier: client.connectionIdentifier, actorIdentifier: "alice" }],
    });
    await client.close();
    expect(client.getSnapshot()).toMatchObject({ status: "closed", peers: [] });
  } finally {
    await client.close();
    authority.close();
    await server.stop(true);
  }
});
