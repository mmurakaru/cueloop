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

test("presence shutdown stays idempotent when a closed-state listener closes it again", async () => {
  const authority = createSyncPresenceAuthority({
    authenticate: async () => ({ actorIdentifier: "alice" }),
    authorize: async (access) => access.actorIdentifiers,
  });
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: authority.fetch });
  const client = createSyncPresenceClient({
    authorityURL: server.url.href,
    workspaceIdentifier: WORKSPACE,
    auth: "alice",
  });
  let notifications = 0;
  let nested: Promise<void> | undefined;

  try {
    await client.refresh();
    client.subscribe(() => {
      if (client.getSnapshot().status === "closed") {
        notifications++;

        if (notifications === 1) nested = client.close();
      }
    });
    const closing = client.close();

    expect(nested).toBe(closing);
    expect(notifications).toBe(1);
    await closing;
  } finally {
    await client.close();
    authority.close();
    await server.stop(true);
  }
});

test("a five-second heartbeat still publishes typing before the activity expires", async () => {
  const authority = createSyncPresenceAuthority({
    authenticate: async () => ({ actorIdentifier: "alice" }),
    authorize: async (access) => access.actorIdentifiers,
  });
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: authority.fetch });
  const client = createSyncPresenceClient({
    authorityURL: server.url.href,
    workspaceIdentifier: WORKSPACE,
    auth: "alice",
    pollMilliseconds: 5000,
  });
  const observed = Promise.withResolvers<void>();
  let deadline: ReturnType<typeof setTimeout> | undefined;

  try {
    await client.refresh();
    client.subscribe(() => {
      if (client.getSnapshot().peers.some((peer) => peer.typing)) observed.resolve();
    });
    deadline = setTimeout(
      () => observed.reject(new Error("Typing was not published before expiry")),
      2000,
    );
    client.update({ typing: true });
    await observed.promise;
    expect(client.getSnapshot().peers[0]?.typing).toBe(true);
  } finally {
    clearTimeout(deadline);
    await client.close();
    authority.close();
    await server.stop(true);
  }
});
