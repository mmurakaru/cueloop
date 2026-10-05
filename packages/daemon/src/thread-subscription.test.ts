import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DaemonServer } from "./server";
import { DaemonClient } from "./client";
import { subscribeThreadState, connectThreadObserver } from "./thread-subscription";

import { createTestSignal } from "../../../test/helpers/test-signal";

test("subscription refresh discards stale reads and disposal suppresses late callbacks", async () => {
  const home = mkdtempSync(join(tmpdir(), "cueloop-subscription-"));
  const server = new DaemonServer({ home, idleExitMs: 0 });

  server.start();
  const client = await DaemonClient.connect({ home });
  const firstRead = createTestSignal<void>();
  const releaseFirst = createTestSignal<void>();
  const latest = createTestSignal<void>();
  const values: string[] = [];
  let reads = 0;
  let dispose = () => {};

  try {
    const thread = await client.sessionCreate(
      { repoRoot: home, branch: "main" },
      { type: "plan", content: "Initial", meta: {} },
    );

    dispose = subscribeThreadState({
      connect: connectThreadObserver({ home }),
      matches: (event) => event.sessionId === thread.id,
      read: async (api) => {
        const state = await api.sessionGet(thread.id);

        if (++reads === 1) {
          firstRead.resolve();
          await releaseFirst.promise;
        }

        return state;
      },
      onValue: (state) => {
        values.push(state.artifact.meta.title ?? "Initial");
        latest.resolve();
      },
      onError: (error) => latest.reject(error),
    });
    await firstRead.promise;
    await client.sessionSetTitle(thread.id, "New");
    await latest.promise;
    releaseFirst.resolve();
    await Promise.resolve();
    expect(values).toEqual(["New"]);
    dispose();
    await client.sessionSetTitle(thread.id, "After disposal");
    expect(values).toEqual(["New"]);
  } finally {
    dispose();
    client.close();
    server.stop();
    rmSync(home, { recursive: true, force: true });
  }
});

test("reconnect subscribes again and refreshes authoritative state even without a notification", async () => {
  const home = mkdtempSync(join(tmpdir(), "cueloop-reconnect-"));
  let server = new DaemonServer({ home, idleExitMs: 0 });

  server.start();
  const client = await DaemonClient.connect({ home });
  const initial = createTestSignal<void>();
  const recovered = createTestSignal<void>();
  let connections = 0;
  const values: string[] = [];
  let dispose = () => {};

  try {
    const thread = await client.sessionCreate(
      { repoRoot: home, branch: "main" },
      { type: "plan", content: "Initial", meta: {} },
    );

    dispose = subscribeThreadState({
      connect: connectThreadObserver({ home }),
      reconnectMs: 1,
      matches: (event) => event.sessionId === thread.id,
      read: (api) => api.sessionGet(thread.id),
      onConnect: () => {
        connections++;
      },
      onValue: (state) => {
        values.push(state.artifact.meta.title ?? "Initial");
        if (connections === 1) initial.resolve();
        else recovered.resolve();
      },
      onError() {},
    });
    await initial.promise;
    server.stop();
    server = new DaemonServer({ home, idleExitMs: 0 });
    server.core.sessionSetTitle(thread.id, "Recovered");
    server.start();
    await recovered.promise;
    expect(connections).toBe(2);
    expect(values).toEqual(["Initial", "Recovered"]);
  } finally {
    dispose();
    client.close();
    server.stop();
    rmSync(home, { recursive: true, force: true });
  }
});

test("a malformed protocol frame stops the observer instead of reconnecting", async () => {
  const { LineBuffer, parseRequestFrame } = await import("./protocol");
  const { socketPath } = await import("./paths");
  const { DAEMON_VERSION } = await import("./version");
  const home = mkdtempSync(join(tmpdir(), "cueloop-subscription-protocol-"));
  const failed = createTestSignal<void>();
  const reads = new Map<object, InstanceType<typeof LineBuffer>>();
  let connections = 0;
  const server = Bun.listen({
    unix: socketPath(home),
    socket: {
      open(socket) {
        reads.set(socket, new LineBuffer());
        connections++;
        if (connections > 1) failed.reject(new Error("Unexpected reconnect"));
      },
      data(socket, bytes) {
        reads.get(socket)!.push(bytes.toString(), (line) => {
          const request = parseRequestFrame(line);

          socket.write(
            JSON.stringify({
              id: request.id,
              result:
                request.method === "daemon.ping"
                  ? { pid: process.pid, version: DAEMON_VERSION }
                  : {},
            }) + "\n",
          );
          if (request.method === "events.subscribe") socket.write("{broken\n");
        });
      },
      close(socket) {
        reads.delete(socket);
      },
    },
  });
  const dispose = subscribeThreadState({
    connect: connectThreadObserver({ home }),
    reconnectMs: 1,
    matches: () => true,
    read: (client) => client.ping(),
    onValue() {},
    onError: (error) => {
      expect(error).toMatchObject({ kind: "protocol" });
      failed.resolve();
    },
  });

  try {
    await failed.promise;
    // A timer boundary proves no reconnect remains scheduled after the protocol closure.
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(connections).toBe(1);
  } finally {
    dispose();
    server.stop(true);
    rmSync(home, { recursive: true, force: true });
  }
});
