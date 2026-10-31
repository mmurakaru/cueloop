import type { FxAcpChild } from "../fx/acp";

/** Present the relay as the ACP child. Bytes stay buffered until the session is ready to parse them. */
export class RelayChild implements FxAcpChild {
  private listener?: (chunk: string) => void;
  private exitListener?: (code: number | null) => void;
  private errorListener?: (error: Error) => void;
  private held: string[] = [];
  private released = false;
  private responseWaiters = new Map<number, (frame: { stopReason?: string }) => void>();

  readonly stdin = {
    write: (chunk: string) => {
      this.onWrite(chunk);
    },
    on: (_event: "error", listener: (error: Error) => void) => {
      this.errorListener = listener;
    },
  };

  readonly stdout = {
    setEncoding: (_encoding: "utf8") => undefined,
    on: (_event: "data", listener: (chunk: string) => void) => {
      this.listener = listener;

      if (!this.released) return;

      for (const chunk of this.held.splice(0)) listener(chunk);
    },
  };

  readonly stderr = { resume: () => undefined };

  constructor(private readonly writeLine: (line: string) => void) {}

  on(event: "error", listener: (error: Error) => void): void;
  on(event: "exit", listener: (code: number | null) => void): void;
  on(
    event: "error" | "exit",
    listener: ((error: Error) => void) | ((code: number | null) => void),
  ): void {
    if (event === "exit") {
      // SAFETY: The exit overload's listener receives the process status, not an Error.
      this.exitListener = listener as (code: number | null) => void;
    } else {
      // SAFETY: The error overload's listener receives the stream Error, not a status code.
      this.errorListener = listener as (error: Error) => void;
    }
  }

  kill(): void {
    this.onShutdown();
  }

  detach(): void {
    this.onDetach();
  }

  push(line: string): void {
    const chunk = line.endsWith("\n") ? line : line + "\n";

    if (this.released && this.listener) this.listener(chunk);
    else this.held.push(chunk);
  }

  release(): void {
    this.released = true;

    if (!this.listener) return;

    for (const chunk of this.held.splice(0)) this.listener(chunk);
  }

  noteResponse(id: number, stopReason: string | undefined): void {
    const waiter = this.responseWaiters.get(id);

    if (!waiter) return;

    this.responseWaiters.delete(id);
    waiter(stopReason === undefined ? {} : { stopReason });
  }

  waitForStop(id: number): Promise<string> {
    return new Promise((resolve, reject) => {
      this.responseWaiters.set(id, (frame) => {
        if (!frame.stopReason) reject(new Error("Fx ACP prompt ended without a stop reason"));
        else resolve(frame.stopReason);
      });
    });
  }

  fail(error: Error): void {
    this.errorListener?.(error);
  }

  exited(code: number | null): void {
    this.exitListener?.(code);

    for (const [id, waiter] of this.responseWaiters) {
      this.responseWaiters.delete(id);
      waiter({});
    }
  }

  onShutdown: () => void = () => {};
  onDetach: () => void = () => {};
  private onWrite: (line: string) => void = (line) => this.writeLine(line);
}
