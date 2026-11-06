import { afterEach, beforeEach, expect, test } from "bun:test";
import { once } from "node:events";
import { mkdtempSync, rmSync } from "node:fs";
import { connect, type Socket } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client, type ClientChannel } from "ssh2";
import { generateMasterKey } from "./crypto";
import { generateEd25519Key } from "./host-key";
import { startGateway, type GatewayHandle } from "./server";
import {
  gatewayResourceLimits,
  gatewayTerminalSize,
  type GatewayResourceLimits,
} from "./resource-limits";
import { MemoryShareStore } from "./store";

let home: string;
let gateway: GatewayHandle;
const sockets = new Set<Socket>();
const clients = new Set<Client>();
const privateKey = generateEd25519Key();

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "cueloop-gateway-limits-"));
});

afterEach(async () => {
  for (const client of clients) client.destroy();
  for (const socket of sockets) socket.destroy();

  clients.clear();
  sockets.clear();
  await gateway?.close();
  rmSync(home, { recursive: true, force: true });
});

async function startTestGateway(
  limits: Partial<GatewayResourceLimits> = {},
  store = new MemoryShareStore(),
) {
  gateway = await startGateway({
    store,
    masterKey: generateMasterKey(),
    hostKeyPath: join(home, "host_key"),
    host: "127.0.0.1",
    port: 0,
    limits,
    onError: () => {},
  });
}

function connectTestSocket(): Socket {
  const socket = connect(gateway.port, "127.0.0.1");

  sockets.add(socket);
  socket.on("error", () => {});

  return socket;
}

async function connectTestClient(username = "share"): Promise<Client> {
  const client = new Client();
  const ready = once(client, "ready");

  clients.add(client);
  client.on("error", () => {});
  client.connect({ host: "127.0.0.1", port: gateway.port, username, privateKey });
  await ready;

  return client;
}

function openTestExec(client: Client): Promise<ClientChannel> {
  return new Promise((resolve, reject) => {
    client.exec("cueloop-share", (error, channel) => {
      if (error) reject(error);
      else resolve(channel);
    });
  });
}

for (const limits of [{ maxConnections: 1 }, { maxConnectionsPerIp: 1 }]) {
  test(`rejects excess raw connections and recovers capacity: ${JSON.stringify(limits)}`, async () => {
    await startTestGateway(limits);
    const first = connectTestSocket();

    await once(first, "data");
    const excess = connectTestSocket();

    await new Promise<void>((resolve) => excess.once("close", () => resolve()));
    expect(excess.destroyed).toBe(true);
    const closed = once(first, "close");

    first.destroy();
    await closed;
    const replacement = connectTestSocket();
    const [banner] = await once(replacement, "data");

    expect(banner.toString()).toContain("SSH-2.0");
  });
}

test("authentication deadline closes clients that never send an SSH identification", async () => {
  await startTestGateway({ authenticationTimeoutMs: 100 });
  const socket = connectTestSocket();

  socket.resume();
  await once(socket, "close");
  expect(socket.destroyed).toBe(true);
});

test("authentication deadline also closes stalled key exchange", async () => {
  await startTestGateway({ authenticationTimeoutMs: 100 });
  const socket = connectTestSocket();

  socket.write("SSH-2.0-stalled-client\r\n");
  socket.resume();
  await once(socket, "close");
  expect(socket.destroyed).toBe(true);
});

test("upload deadline survives trickled input and leaves authenticated connections usable", async () => {
  await startTestGateway({ authenticationTimeoutMs: 1000, uploadTimeoutMs: 100 });
  const client = await connectTestClient();
  const channel = await openTestExec(client);
  const closed = once(channel, "close");
  const trickle = setInterval(() => channel.write("x"), 10);

  channel.resume();
  channel.stderr.resume();
  try {
    await closed;
  } finally {
    clearInterval(trickle);
  }

  const replacement = await openTestExec(client);
  const finished = once(replacement, "close");

  replacement.resume();
  replacement.stderr.resume();
  replacement.end("invalid blob");
  await finished;
});

test("channel quota rejects excess channels and releases closed channels", async () => {
  await startTestGateway({ maxChannelsPerConnection: 1 });
  const client = await connectTestClient();
  const channel = await openTestExec(client);

  await expect(openTestExec(client)).rejects.toThrow();
  const closed = once(channel, "close");

  channel.resume();
  channel.stderr.resume();
  channel.end("invalid blob");
  await closed;
  const replacement = await openTestExec(client);

  expect(replacement).toBeDefined();
  replacement.destroy();
});

test("viewer quota includes pending storage reads and releases disconnected viewers", async () => {
  let releaseRead: () => void = () => {};
  let notifyRead: () => void = () => {};
  const reading = new Promise<void>((resolve) => {
    notifyRead = resolve;
  });
  const blocked = new Promise<void>((resolve) => {
    releaseRead = resolve;
  });
  const store = new MemoryShareStore();

  store.get = async () => {
    notifyRead();
    await blocked;

    return null;
  };
  await startTestGateway({ maxViewers: 1 }, store);
  const first = await connectTestClient("p_abcdefgh");
  const shell = (client: Client) =>
    new Promise<ClientChannel>((resolve, reject) => {
      client.shell((error, channel) => {
        if (error) reject(error);
        else resolve(channel);
      });
    });

  await shell(first);

  await reading;
  const second = await connectTestClient("p_abcdefgh");
  const excess = await shell(second);
  let message = "";
  const closed = once(excess, "close");

  excess.stderr.on("data", (bytes) => {
    message += bytes.toString();
  });
  excess.resume();
  await closed;
  expect(message).toContain("viewer capacity reached");
  const viewerClosed = once(first, "close");

  first.end();
  await viewerClosed;
  const pendingExcess = await shell(second);
  let pendingMessage = "";
  const pendingClosed = once(pendingExcess, "close");

  pendingExcess.stderr.on("data", (bytes) => {
    pendingMessage += bytes.toString();
  });
  pendingExcess.resume();
  await pendingClosed;
  expect(pendingMessage).toContain("viewer capacity reached");
  releaseRead();
  const replacement = await shell(second);
  let replacementError = "";
  const replacementClosed = once(replacement, "close");

  replacement.stderr.on("data", (bytes) => {
    replacementError += bytes.toString();
  });
  replacement.resume();
  await replacementClosed;
  expect(replacementError).toContain("not found");
});

test("rejects invalid resource limits before starting the gateway", () => {
  for (const maxConnections of [0, -1, Infinity, NaN, 1.5]) {
    expect(() => gatewayResourceLimits({ maxConnections })).toThrow(
      "Invalid gateway resource limit",
    );
  }
});

test("authenticated reviews outlive the authentication deadline", async () => {
  await startTestGateway({ authenticationTimeoutMs: 500 });
  const client = await connectTestClient();
  const stalled = connectTestSocket();

  stalled.resume();
  await once(stalled, "close");
  const channel = await openTestExec(client);
  const closed = once(channel, "close");

  channel.resume();
  channel.stderr.resume();
  channel.end("invalid blob");
  await closed;
});

test("terminal size bounds normal, oversized, and zero dimensions", () => {
  const limits = gatewayResourceLimits();

  expect(gatewayTerminalSize(80, 24, limits)).toEqual({ cols: 80, rows: 24 });
  expect(gatewayTerminalSize(0xffffffff, 0xffffffff, limits)).toEqual({ cols: 300, rows: 100 });
  expect(gatewayTerminalSize(0, 0, limits)).toEqual({ cols: 1, rows: 1 });
});

test("shutdown destroys sockets that have not sent an SSH identification", async () => {
  await startTestGateway();
  const socket = connectTestSocket();

  await once(socket, "data");
  socket.resume();
  const closed = once(socket, "close");

  await gateway.close();
  await closed;
  expect(socket.destroyed).toBe(true);
});
