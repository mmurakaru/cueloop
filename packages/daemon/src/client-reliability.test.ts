import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as v from "valibot";
import { DaemonClient } from "./client";
import { DAEMON_VERSION } from "./version";
import { LineBuffer, parseRequestFrame } from "./protocol";
import { socketPath } from "./paths";

test("malformed response results reject promptly and leave the connection usable", async () => {
  const home = mkdtempSync(join(tmpdir(), "cueloop-client-contract-"));
  const buffers = new Map<object, LineBuffer>();
  const server = Bun.listen({
    unix: socketPath(home),
    socket: {
      open(socket) {
        buffers.set(socket, new LineBuffer());
      },
      data(socket, data) {
        buffers.get(socket)!.push(data.toString(), (line) => {
          const request = parseRequestFrame(line);
          const result =
            request.method === "daemon.ping"
              ? { pid: process.pid, version: DAEMON_VERSION }
              : request.method === "daemon.hello"
                ? {}
                : "malformed";
          socket.write(JSON.stringify({ id: request.id, result }) + "\n");
        });
      },
      close(socket) {
        buffers.delete(socket);
      },
    },
  });
  let client: DaemonClient | undefined;

  try {
    client = await DaemonClient.connect({ home });
    await expect(client.request("test.number", {}, v.number(), 100)).rejects.toMatchObject({
      _tag: "DaemonTransportError",
      kind: "protocol",
      certainty: "unknown",
    });
    expect((await client.ping()).pid).toBe(process.pid);
  } finally {
    client?.close();
    server.stop(true);
    rmSync(home, { recursive: true, force: true });
  }
});

test("deadlines, local abort and close reject outstanding requests without cancelling daemon work", async () => {
  const home = mkdtempSync(join(tmpdir(), "cueloop-client-cancel-"));
  const buffers = new Map<object, LineBuffer>();
  const work: number[] = [];
  const server = Bun.listen({
    unix: socketPath(home),
    socket: {
      open(socket) {
        buffers.set(socket, new LineBuffer());
      },
      data(socket, data) {
        buffers.get(socket)!.push(data.toString(), (line) => {
          const request = parseRequestFrame(line);
          if (request.method === "work") {
            work.push(request.id);
            return;
          }
          socket.write(
            JSON.stringify({
              id: request.id,
              result:
                request.method === "daemon.ping"
                  ? { pid: process.pid, version: DAEMON_VERSION }
                  : {},
            }) + "\n",
          );
        });
      },
      close(socket) {
        buffers.delete(socket);
      },
    },
  });
  const client = await DaemonClient.connect({ home });

  try {
    const alreadyCancelled = new AbortController();
    alreadyCancelled.abort();
    await expect(
      client.request("work", {}, v.number(), { signal: alreadyCancelled.signal }),
    ).rejects.toMatchObject({ kind: "cancelled", certainty: "not_sent" });
    await expect(client.request("work", {}, v.number(), { timeoutMs: 10 })).rejects.toMatchObject({
      kind: "timeout",
      certainty: "unknown",
    });
    expect(work).toHaveLength(1);
    const controller = new AbortController();
    const waiting = client.request("work", {}, v.number(), { signal: controller.signal });
    await client.ping();
    controller.abort();
    await expect(waiting).rejects.toMatchObject({ kind: "cancelled", certainty: "unknown" });
    expect(work).toHaveLength(2);
    const pending = client.request("work", {}, v.number());
    client.close();
    await expect(pending).rejects.toMatchObject({ kind: "connection", certainty: "unknown" });
    await expect(client.ping()).rejects.toMatchObject({
      kind: "connection",
      certainty: "not_sent",
    });
  } finally {
    client.close();
    server.stop(true);
    rmSync(home, { recursive: true, force: true });
  }
});

test("malformed frames reject all pending requests as protocol failures", async () => {
  const home = mkdtempSync(join(tmpdir(), "cueloop-client-frame-"));
  const buffers = new Map<object, LineBuffer>();
  const server = Bun.listen({
    unix: socketPath(home),
    socket: {
      open(socket) {
        buffers.set(socket, new LineBuffer());
      },
      data(socket, data) {
        buffers.get(socket)!.push(data.toString(), (line) => {
          const request = parseRequestFrame(line);
          if (request.method === "bad-frame") {
            socket.write("{broken\n");
            return;
          }
          socket.write(
            JSON.stringify({
              id: request.id,
              result:
                request.method === "daemon.ping"
                  ? { pid: process.pid, version: DAEMON_VERSION }
                  : {},
            }) + "\n",
          );
        });
      },
      close(socket) {
        buffers.delete(socket);
      },
    },
  });
  const client = await DaemonClient.connect({ home });

  try {
    await expect(client.request("bad-frame", {}, v.number())).rejects.toMatchObject({
      kind: "protocol",
      certainty: "unknown",
    });
    await expect(client.ping()).rejects.toMatchObject({
      kind: "connection",
      certainty: "not_sent",
    });
  } finally {
    client.close();
    server.stop(true);
    rmSync(home, { recursive: true, force: true });
  }
});
