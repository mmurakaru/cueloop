import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import * as v from "valibot";

const RpcFrameSchema = v.object({
  jsonrpc: v.literal("2.0"),
  id: v.optional(v.union([v.string(), v.number()])),
  method: v.optional(v.string()),
  params: v.optional(v.unknown()),
  result: v.optional(v.unknown()),
  error: v.optional(v.object({ code: v.number(), message: v.string() })),
});

/** ACP frames remain unknown until each method's boundary validates its payload. */
export type FxAcpFrame = v.InferOutput<typeof RpcFrameSchema>;

interface FxRequestMap {
  initialize: {
    protocolVersion: number;
    clientCapabilities: Record<string, never>;
    clientInfo: { name: string; version: string };
  };
  "session/new": { cwd: string; mcpServers: never[] };
  "session/load": { sessionId: string; cwd: string; mcpServers: never[] };
  "session/set_mode": { sessionId: string; modeId: string };
  "session/prompt": { sessionId: string; prompt: { type: "text"; text: string }[] };
}

interface FxAcpOutbound {
  jsonrpc: "2.0";
  id?: number | string;
  method?: string;
  params?: FxRequestMap[keyof FxRequestMap] | { sessionId: string };
  result?: { outcome: { outcome: "selected" | "cancelled"; optionId?: string } };
  error?: { code: number; message: string };
}

/** Launch configuration is daemon-owned and never supplied over the review socket. */
export interface FxAcpOptions {
  command?: string[];
  env?: NodeJS.ProcessEnv;
  cwd: string;
  onFrame: (frame: FxAcpFrame) => void;
  onExit: (error: Error) => void;
}

/** Own one fx ACP process; requests time out and process exit rejects every waiter. */
export class FxAcpConnection {
  private readonly child: ChildProcessWithoutNullStreams;
  private sequence = 0;
  private buffer = "";
  private closed = false;
  private pending = new Map<
    number,
    {
      resolve: (frame: FxAcpFrame) => void;
      reject: (error: Error) => void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();

  constructor(private readonly options: FxAcpOptions) {
    const [command, ...args] = options.command ?? ["fx", "acp"];

    this.child = spawn(command!, args, {
      cwd: options.cwd,
      env: options.env ?? process.env,
      stdio: "pipe",
    });
    this.child.stdout.setEncoding("utf8");
    this.child.stdout.on("data", (chunk: string) => this.readFrames(chunk));
    // Drain diagnostics, but do not copy potentially private stderr into the transcript.
    this.child.stderr.resume();
    this.child.stdin.on("error", (error) => this.fail(error));
    this.child.on("error", (error) => this.fail(error));
    this.child.on("exit", (code) =>
      this.fail(new Error(`Fx ACP process exited (${code ?? "signal"})`)),
    );
  }

  /** Send one ACP request; a prompt has a longer deadline than initialization. */
  request<M extends keyof FxRequestMap, T>(
    method: M,
    params: FxRequestMap[M],
    schema: v.GenericSchema<T>,
    timeoutMs = 30_000,
  ): Promise<T> {
    if (this.closed) return Promise.reject(new Error("Fx ACP connection is closed"));
    const id = ++this.sequence;

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.fail(new Error(`Fx ACP request timed out: ${method}`));
        this.child.kill();
      }, timeoutMs);

      this.pending.set(id, {
        resolve: (frame) => {
          try {
            resolve(v.parse(schema, frame.result));
          } catch {
            reject(new Error(`Fx ACP invalid response: ${method}`));
          }
        },
        reject,
        timer,
      });
      this.write({ jsonrpc: "2.0", id, method, params });
    });
  }

  /** Notifications and permission replies share the ordered ACP input stream. */
  write(frame: FxAcpOutbound): void {
    if (!this.closed) this.child.stdin.write(JSON.stringify(frame) + "\n");
  }

  /** Closing a connection terminates its process and rejects unfinished requests. */
  close(): void {
    this.fail(new Error("Fx ACP connection closed"));
    this.child.kill();
  }

  private readFrames(chunk: string): void {
    this.buffer += chunk;
    if (Buffer.byteLength(this.buffer) > 8 * 1024 * 1024) {
      this.fail(new Error("Fx ACP frame exceeds 8 MiB"));
      this.child.kill();

      return;
    }
    for (;;) {
      const index = this.buffer.indexOf("\n");

      if (index < 0) return;
      const line = this.buffer.slice(0, index);

      this.buffer = this.buffer.slice(index + 1);
      try {
        const frame = v.parse(RpcFrameSchema, JSON.parse(line));
        const responseId = v.safeParse(v.number(), frame.id);
        const waiting = responseId.success ? this.pending.get(responseId.output) : undefined;

        if (waiting && !frame.method) {
          clearTimeout(waiting.timer);
          if (responseId.success) this.pending.delete(responseId.output);
          if (frame.error) waiting.reject(new Error(`Fx ACP error: ${frame.error.message}`));
          else waiting.resolve(frame);
        } else this.options.onFrame(frame);
      } catch {
        this.fail(new Error("Fx ACP received an invalid frame"));
        this.child.kill();

        return;
      }
    }
  }

  private fail(error: Error): void {
    if (this.closed) return;
    this.closed = true;
    for (const waiting of this.pending.values()) {
      clearTimeout(waiting.timer);
      waiting.reject(error);
    }
    this.pending.clear();
    this.options.onExit(error);
  }
}
