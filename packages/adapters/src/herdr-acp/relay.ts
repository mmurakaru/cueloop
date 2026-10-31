import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { connect, createServer, type Server, type Socket } from "node:net";
import { randomUUID } from "node:crypto";
import { chmodSync, mkdirSync, openSync, rmSync, write, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import * as v from "valibot";
import { ClientOpSchema, type ClientOp, type RelayOp, type RelayState } from "./protocol";
import {
  answeredRequestSequences,
  emptyScan,
  foldRecord,
  type AcpScan,
  type TranscriptRecord,
} from "./scan";

const LOG_FLUSH_BYTES = 64 * 1024;
const LOG_FLUSH_MS = 8;
const DEFAULT_IDLE_MS = 60_000;
const DEFAULT_ABANDON_MS = 10 * 60_000;

/** Drop lines the daemon has already checkpointed. Later cursors stay for replay. */
export function recordsAfter(
  records: readonly TranscriptRecord[],
  cursor: number,
): TranscriptRecord[] {
  const start = records.findIndex((record) => record.sequence > cursor);

  if (start < 0) return [];

  if (start === 0) return records.slice();

  return records.slice(start);
}

function positiveMs(value: string | undefined, fallback: number): number {
  const parsed = Number(value);

  if (!Number.isFinite(parsed) || parsed < 1) return fallback;

  return parsed;
}

interface RelayArgs {
  socketPath: string;
  transcriptPath: string;
  cwd: string;
  command: string[];
}

/**
 * Keep one ACP child alive and log every stdin and stdout line.
 * A later client replays the log; the child never sees a terminal.
 */
export async function runHerdrAcpRelay(argv: string[]): Promise<void> {
  const args = parseRelayArgs(argv);
  const relay = new AcpRelay(args);

  await relay.start();
}

export function parseRelayArgs(argv: string[]): RelayArgs {
  let socketPath: string | undefined;
  let transcriptPath: string | undefined;
  let cwd = process.cwd();
  const command: string[] = [];
  let separator = false;

  for (let index = 0; index < argv.length; index++) {
    const token = argv[index]!;

    if (separator) {
      command.push(token);
      continue;
    }

    if (token === "--") {
      separator = true;
      continue;
    }

    if (token === "--socket") socketPath = argv[++index];
    else if (token === "--transcript") transcriptPath = argv[++index];
    else if (token === "--cwd") cwd = argv[++index] ?? cwd;
    else throw new Error(`Unknown herdr ACP relay argument: ${token}`);
  }

  if (!socketPath || !transcriptPath || command.length === 0) {
    throw new Error("herdr ACP relay requires --socket, --transcript, and a command");
  }

  return { socketPath, transcriptPath, cwd, command };
}

class AcpRelay {
  private readonly epoch = randomUUID();
  private readonly records: TranscriptRecord[] = [];
  private scan: AcpScan = emptyScan();
  private sequence = 0;
  private child?: ChildProcessWithoutNullStreams;
  private server?: Server;
  private following = false;
  private client?: Socket;
  private buffer = "";
  private closed = false;
  private logFd = 0;
  private logBuffer = "";
  private logTimer?: ReturnType<typeof setTimeout>;
  private logChain: Promise<void> = Promise.resolve();
  private idleTimer?: ReturnType<typeof setTimeout>;
  private acked = 0;
  private readonly idleMs = positiveMs(process.env.HERDR_ACP_IDLE_MS, DEFAULT_IDLE_MS);
  private readonly abandonMs = positiveMs(process.env.HERDR_ACP_ABANDON_MS, DEFAULT_ABANDON_MS);

  constructor(private readonly args: RelayArgs) {}

  async start(): Promise<void> {
    mkdirSync(dirname(this.args.socketPath), { recursive: true, mode: 0o700 });

    if (await socketAccepts(this.args.socketPath)) return;

    rmSync(this.args.socketPath, { force: true });
    rmSync(this.args.transcriptPath, { force: true });
    this.openLog();
    const server = createServer((socket) => this.accept(socket));

    this.server = server;
    await listen(server, this.args.socketPath);
    chmodSync(this.args.socketPath, 0o600);
    this.spawnChild();
    this.writePidFile();
    await new Promise(() => {});
  }

  private spawnChild(): void {
    const [command, ...args] = this.args.command;

    if (!command) throw new Error("herdr ACP relay command is empty");

    const child = spawn(command, args, {
      cwd: this.args.cwd,
      env: process.env,
      stdio: "pipe",
    });

    this.child = child;
    child.stdout.setEncoding("utf8");
    child.stderr.resume();
    let pending = "";

    child.stdout.on("data", (chunk: string) => {
      pending += chunk;
      pending = this.consumeChild(pending);
    });
    child.on("exit", (code) => this.finish(code));
    child.on("error", () => this.finish(null));
  }

  private consumeChild(pending: string): string {
    for (;;) {
      const index = pending.indexOf("\n");

      if (index < 0) return pending;

      this.record("out", pending.slice(0, index));
      pending = pending.slice(index + 1);
    }
  }

  private record(direction: "in" | "out", line: string): void {
    const sequence = ++this.sequence;
    const record = { sequence, direction, line };

    this.records.push(record);
    this.scan = foldRecord(this.scan, record);
    this.queueLog(JSON.stringify(record) + "\n");

    if (direction === "out" && this.following) this.send({ op: "stdout", cursor: sequence, line });
  }

  private writePidFile(): void {
    const path = `${this.args.socketPath}.pid`;

    writeFileSync(path, `${process.pid}\n${this.child?.pid ?? 0}\n`, { mode: 0o600 });
    chmodSync(path, 0o600);
  }

  private openLog(): void {
    this.logFd = openSync(this.args.transcriptPath, "a", 0o600);
    chmodSync(this.args.transcriptPath, 0o600);
  }

  private queueLog(line: string): void {
    this.logBuffer += line;

    if (this.logBuffer.length >= LOG_FLUSH_BYTES) {
      this.flushLog();

      return;
    }

    if (this.logTimer) return;

    this.logTimer = setTimeout(() => this.flushLog(), LOG_FLUSH_MS);
  }

  private flushLog(): void {
    if (this.logTimer) {
      clearTimeout(this.logTimer);
      this.logTimer = undefined;
    }

    if (!this.logBuffer || !this.logFd) return;

    const chunk = this.logBuffer;

    this.logBuffer = "";
    this.logChain = this.logChain.then(
      () =>
        new Promise((resolve) => {
          write(this.logFd, chunk, () => resolve());
        }),
    );
  }

  private accept(socket: Socket): void {
    this.clearIdle();
    this.client?.destroy();
    this.client = socket;
    this.buffer = "";
    this.following = false;
    socket.setEncoding("utf8");
    socket.on("data", (chunk: string) => this.readClient(chunk));
    socket.on("error", () => this.drop(socket));
    socket.on("close", () => this.drop(socket));
  }

  private drop(socket: Socket): void {
    if (this.client !== socket) return;

    this.client = undefined;

    if (this.closed) {
      this.shutdown();

      return;
    }

    this.armIdle();
  }

  private clearIdle(): void {
    if (!this.idleTimer) return;

    clearTimeout(this.idleTimer);
    this.idleTimer = undefined;
  }

  private armIdle(): void {
    this.clearIdle();
    const waiting =
      !this.closed && this.scan.prompt !== null && this.scan.prompt.stopReason === null;
    const delay = waiting ? this.abandonMs : this.idleMs;

    this.idleTimer = setTimeout(() => {
      if (this.client) return;

      this.shutdown();
    }, delay);
    this.idleTimer.unref();
  }

  private readClient(chunk: string): void {
    this.buffer += chunk;

    for (;;) {
      const index = this.buffer.indexOf("\n");

      if (index < 0) return;

      const line = this.buffer.slice(0, index);

      this.buffer = this.buffer.slice(index + 1);

      if (!line) continue;

      let value: unknown;

      try {
        value = JSON.parse(line);
      } catch {
        continue;
      }

      const parsed = v.safeParse(ClientOpSchema, value);

      if (!parsed.success) continue;

      this.operate(parsed.output);
    }
  }

  private operate(operation: ClientOp): void {
    if (operation.op === "attach") this.send({ op: "state", state: this.state() });
    else if (operation.op === "follow") this.following = true;
    else if (operation.op === "write") this.writeChild(operation.line);
    else if (operation.op === "replay") this.replay(operation.after);
    else if (operation.op === "ack") this.acknowledge(operation.cursor);
    else if (operation.op === "shutdown") this.shutdown();
  }

  private acknowledge(cursor: number): void {
    if (cursor <= this.acked) return;

    this.acked = cursor;
    const start = this.records.findIndex((record) => record.sequence > cursor);

    if (start < 0) {
      this.records.length = 0;

      return;
    }

    if (start === 0) return;

    this.records.splice(0, start);
  }

  private writeChild(line: string): void {
    this.record("in", line);
    this.child?.stdin.write(line.endsWith("\n") ? line : line + "\n");
  }

  private replay(after: number): void {
    const answered = answeredRequestSequences(this.records);
    const lines = this.records.filter(
      (record) =>
        record.direction === "out" && record.sequence > after && !answered.has(record.sequence),
    );

    for (const record of lines) {
      this.send({ op: "stdout", cursor: record.sequence, line: record.line });
    }

    this.send({ op: "replay-end", cursor: this.scan.cursor });
    this.following = true;
  }

  private state(): RelayState {
    return {
      epoch: this.epoch,
      sessionId: this.scan.sessionId,
      sequence: this.scan.sequence,
      cursor: this.scan.cursor,
      prompt: this.scan.prompt,
      running: this.child?.exitCode === null && !this.closed,
      pid: this.child?.pid ?? 0,
    };
  }

  private finish(code: number | null): void {
    if (this.closed) return;

    this.closed = true;
    this.send({ op: "exit", code });
    this.server?.close();
    rmSync(this.args.socketPath, { force: true });

    if (!this.client) this.shutdown();
  }

  private shutdown(): void {
    this.clearIdle();
    this.flushLog();
    void this.logChain.finally(() => {
      this.child?.kill();
      rmSync(`${this.args.socketPath}.pid`, { force: true });
      this.removeTerminal();
      this.client?.end();
      process.exit(0);
    });
  }

  private removeTerminal(): void {
    const binary = process.env.CUELOOP_HC;
    const name = process.env.CUELOOP_HERDR_TERMINAL;

    if (!binary || !name) return;

    const cleaner = spawn(
      "/bin/sh",
      [
        "-c",
        'sleep 0.2; i=0; while [ "$i" -lt 10 ]; do "$1" rm "$2" >/dev/null 2>&1 && exit 0; i=$((i+1)); sleep 0.2; done',
        "sh",
        binary,
        name,
      ],
      { detached: true, stdio: "ignore", env: process.env },
    );

    cleaner.unref();
  }

  private send(message: RelayOp): void {
    if (!this.client || this.client.destroyed) return;

    this.client.write(JSON.stringify(message) + "\n");
  }
}

function listen(server: Server, socketPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(socketPath, () => {
      server.off("error", reject);
      resolve();
    });
  });
}

function socketAccepts(socketPath: string): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = connect(socketPath);

    socket.once("connect", () => {
      socket.end();
      resolve(true);
    });
    socket.once("error", () => resolve(false));
  });
}

if (import.meta.main) {
  await runHerdrAcpRelay(process.argv.slice(2));
}
