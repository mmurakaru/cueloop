import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { connect, createServer, type Server, type Socket } from "node:net";
import { randomUUID } from "node:crypto";
import { appendFileSync, chmodSync, mkdirSync, rmSync } from "node:fs";
import { dirname } from "node:path";
import * as v from "valibot";
import {
  ClientOpSchema,
  RelayStateSchema,
  type ClientOp,
  type RelayOp,
  type RelayState,
} from "./protocol";
import { emptyScan, foldRecord, type AcpScan, type TranscriptRecord } from "./scan";

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
  private following = false;
  private client?: Socket;
  private buffer = "";
  private closed = false;

  constructor(private readonly args: RelayArgs) {}

  async start(): Promise<void> {
    mkdirSync(dirname(this.args.socketPath), { recursive: true, mode: 0o700 });

    if (await socketAccepts(this.args.socketPath)) return;

    rmSync(this.args.socketPath, { force: true });
    rmSync(this.args.transcriptPath, { force: true });
    const server = createServer((socket) => this.accept(socket));

    await listen(server, this.args.socketPath);
    chmodSync(this.args.socketPath, 0o600);
    this.spawnChild();
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

  private record(dir: "in" | "out", line: string): void {
    const seq = ++this.sequence;
    const record = { seq, dir, line };

    this.records.push(record);
    this.scan = foldRecord(this.scan, record);
    appendFileSync(this.args.transcriptPath, JSON.stringify(record) + "\n");

    if (dir === "out" && this.following) this.send({ op: "stdout", cursor: seq, line });
  }

  private accept(socket: Socket): void {
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
    if (this.client === socket) this.client = undefined;
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
    else if (operation.op === "shutdown") this.shutdown();
  }

  private writeChild(line: string): void {
    this.record("in", line);
    this.child?.stdin.write(line.endsWith("\n") ? line : line + "\n");
  }

  private replay(after: number): void {
    const lines = this.records.filter((record) => record.dir === "out" && record.seq > after);

    for (const record of lines) {
      this.send({ op: "stdout", cursor: record.seq, line: record.line });
    }

    this.send({ op: "replay-end", cursor: this.scan.cursor });
    this.following = true;
  }

  private state(): RelayState {
    return v.parse(RelayStateSchema, {
      epoch: this.epoch,
      sessionId: this.scan.sessionId,
      sequence: this.scan.sequence,
      cursor: this.scan.cursor,
      prompt: this.scan.prompt,
      running: this.child?.exitCode === null && !this.closed,
      pid: this.child?.pid ?? 0,
    });
  }

  private finish(code: number | null): void {
    this.closed = true;
    this.send({ op: "exit", code });
  }

  private shutdown(): void {
    this.child?.kill();
    this.client?.end();
    process.exit(0);
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
