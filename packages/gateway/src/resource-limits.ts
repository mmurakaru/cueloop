import { createServer, type Socket } from "node:net";
import type { Server } from "ssh2";

/** Gateway resource limits count pending work as well as established sessions. */
export interface GatewayResourceLimits {
  maxConnections: number;
  maxConnectionsPerIp: number;
  maxChannelsPerConnection: number;
  maxViewers: number;
  authenticationTimeoutMs: number;
  uploadTimeoutMs: number;
  maxTerminalColumns: number;
  maxTerminalRows: number;
}

/** Defaults bound a single gateway process without expiring active reviews. */
export function gatewayResourceLimits(
  overrides: Partial<GatewayResourceLimits> = {},
): GatewayResourceLimits {
  const limits = {
    maxConnections: 128,
    maxConnectionsPerIp: 16,
    maxChannelsPerConnection: 8,
    maxViewers: 32,
    authenticationTimeoutMs: 15_000,
    uploadTimeoutMs: 30_000,
    maxTerminalColumns: 300,
    maxTerminalRows: 100,
    ...overrides,
  };

  for (const [name, value] of Object.entries(limits)) {
    if (!Number.isSafeInteger(value) || value < 1) {
      throw new RangeError(`Invalid gateway resource limit ${name}: expected a positive integer`);
    }
  }

  return limits;
}

/** Bound raw TCP connections before SSH identification and authentication allocate work. */
export function createGatewayIngress(ssh: Server, limits: GatewayResourceLimits) {
  const sockets = new Set<Socket>();
  const perIp = new Map<string, number>();
  const pending = new Map<string, ReturnType<typeof setTimeout>>();
  const server = createServer((socket) => {
    const ip = socket.remoteAddress ?? "unknown";
    const count = perIp.get(ip) ?? 0;

    if (sockets.size >= limits.maxConnections || count >= limits.maxConnectionsPerIp) {
      socket.destroy();

      return;
    }

    const key = `${ip}:${socket.remotePort}`;
    const timer = setTimeout(() => socket.destroy(), limits.authenticationTimeoutMs);

    sockets.add(socket);
    perIp.set(ip, count + 1);
    pending.set(key, timer);
    socket.on("error", () => {});
    socket.once("close", () => {
      clearTimeout(timer);
      pending.delete(key);
      sockets.delete(socket);
      const remaining = (perIp.get(ip) ?? 1) - 1;

      if (remaining === 0) perIp.delete(ip);
      else perIp.set(ip, remaining);
    });
    ssh.injectSocket(socket);
  });

  ssh.on("connection", (client, info) => {
    client.once("ready", () => {
      const key = `${info.ip}:${info.port}`;

      clearTimeout(pending.get(key));
      pending.delete(key);
    });
  });

  return {
    server,
    destroy() {
      for (const socket of sockets) socket.destroy();
    },
  };
}

/** Clamp terminal size for both initial PTY allocation and subsequent resize requests. */
export function gatewayTerminalSize(cols: number, rows: number, limits: GatewayResourceLimits) {
  return {
    cols: Math.max(1, Math.min(cols, limits.maxTerminalColumns)),
    rows: Math.max(1, Math.min(rows, limits.maxTerminalRows)),
  };
}
