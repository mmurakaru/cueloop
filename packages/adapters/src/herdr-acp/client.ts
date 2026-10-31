import { connect, type Socket } from "node:net";
import * as v from "valibot";
import {
  RelayOpSchema,
  type ClientOp,
  type RelayOp,
  type RelayState,
  type StdoutLine,
} from "./protocol";

type LiveHandler = (line: StdoutLine) => void;

/** One daemon's view of a relay. Replacing the socket does not stop the child. */
export class HerdrRelayClient {
  private socket?: Socket;
  private buffer = "";
  private mode: "hold" | "replay" | "live" = "hold";
  private replaySeenEnd = false;
  private historical: StdoutLine[] = [];
  private trailing: StdoutLine[] = [];
  private replayDone?: () => void;
  private stateWait?: (state: RelayState) => void;
  onStdout: LiveHandler = () => {};
  onChildExit: (code: number | null) => void = () => {};
  onSocketClose: () => void = () => {};
  state?: RelayState;

  connect(socketPath: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const socket = connect(socketPath);

      this.socket = socket;
      socket.setEncoding("utf8");
      socket.once("connect", () => resolve());
      socket.once("error", reject);
      socket.on("data", (chunk: string) => this.read(chunk));
      socket.on("close", () => this.onSocketClose());
    });
  }

  async attach(): Promise<RelayState> {
    const state = new Promise<RelayState>((resolve, reject) => {
      this.stateWait = resolve;
      this.socket?.once("error", reject);
    });

    this.send({ op: "attach" });

    this.state = await state;

    return this.state;
  }

  /** Stream only lines that arrive after this call. Startup uses this when no session exists yet. */
  follow(): void {
    this.mode = "live";
    this.send({ op: "follow" });
  }

  write(line: string): void {
    this.send({ op: "write", line: line.endsWith("\n") ? line.slice(0, -1) : line });
  }

  /**
   * Lines already stored with a cursor above `after`, then any lines that arrived while
   * that snapshot was being sent. Following turns on at the end of the snapshot.
   */
  async replay(after: number): Promise<{ historical: StdoutLine[]; trailing: StdoutLine[] }> {
    this.mode = "replay";
    this.replaySeenEnd = false;
    this.historical = [];
    this.trailing = [];
    const done = new Promise<void>((resolve) => {
      this.replayDone = resolve;
    });

    this.send({ op: "replay", after });
    await done;
    const result = { historical: this.historical, trailing: this.trailing };

    this.mode = "live";

    return result;
  }

  shutdown(): void {
    this.send({ op: "shutdown" });
    this.socket?.end();
  }

  close(): void {
    this.socket?.end();
  }

  private send(message: ClientOp): void {
    this.socket?.write(JSON.stringify(message) + "\n");
  }

  private read(chunk: string): void {
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

      const parsed = v.safeParse(RelayOpSchema, value);

      if (!parsed.success) continue;

      this.apply(parsed.output);
    }
  }

  private apply(message: RelayOp): void {
    if (message.op === "state") this.stateWait?.(message.state);
    else if (message.op === "exit") this.onChildExit(message.code);
    else if (message.op === "replay-end") this.finishReplay();
    else if (message.op === "stdout") this.takeStdout(message);
  }

  private takeStdout(message: { cursor: number; line: string }): void {
    if (this.mode === "replay" && !this.replaySeenEnd) this.historical.push(message);
    else if (this.mode === "replay") this.trailing.push(message);
    else if (this.mode === "live") this.onStdout(message);
  }

  private finishReplay(): void {
    this.replaySeenEnd = true;
    this.replayDone?.();
  }
}
