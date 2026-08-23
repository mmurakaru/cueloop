/**
 * A pseudo-terminal for Bun, over cueloop's own forkpty(3) FFI shim
 * (native/src/pty.c) - the in-house replacement for the third-party bun-pty
 * package. Node-pty's N-API addon crashes Bun on macOS arm64, so the embedded
 * Agent-tab terminal needs an FFI-based PTY; owning the ~150-line C shim removes
 * a low-adoption native dependency from the supply chain.
 *
 * The API mirrors node-pty/bun-pty just enough for `terminal-pane.ts`: `spawn`
 * returns a `Pty` with `onData`/`onExit` events and `write`/`resize`/`kill`.
 * `ptyAvailable()` returns false when no prebuilt shim ships for this platform,
 * so callers fall back to a herdr split, exactly like the Ghostty VT loader.
 */

import { dlopen, FFIType, ptr } from "bun:ffi";
import { existsSync } from "node:fs";
import { join } from "node:path";

const DEFAULT_COLS = 80;
const DEFAULT_ROWS = 24;
/** How long the read loop sleeps when the child produced no output this tick. */
const READ_IDLE_MS = 8;
const READ_BUFFER_BYTES = 4096;
/** cueloop_pty_read's sentinel: the child has exited and its output is drained. */
const CHILD_EXITED = -2;

export interface PtyForkOptions {
  name?: string;
  cols?: number;
  rows?: number;
  cwd?: string;
  env?: Record<string, string>;
}

export interface ExitEvent {
  exitCode: number;
}

export interface Disposable {
  dispose(): void;
}

/** The subset of node-pty's IPty that cueloop consumes. */
export interface IPty {
  readonly pid: number;
  readonly cols: number;
  readonly rows: number;
  readonly onData: (listener: (data: string) => void) => Disposable;
  readonly onExit: (listener: (event: ExitEvent) => void) => Disposable;
  write(data: string): void;
  resize(cols: number, rows: number): void;
  kill(signal?: string): void;
}

const PTY_SYMBOLS = {
  cueloop_pty_spawn: {
    args: [FFIType.ptr, FFIType.cstring, FFIType.ptr, FFIType.i32, FFIType.i32],
    returns: FFIType.i32,
  },
  cueloop_pty_write: { args: [FFIType.i32, FFIType.ptr, FFIType.i32], returns: FFIType.i32 },
  cueloop_pty_read: { args: [FFIType.i32, FFIType.ptr, FFIType.i32], returns: FFIType.i32 },
  cueloop_pty_resize: { args: [FFIType.i32, FFIType.i32, FFIType.i32], returns: FFIType.i32 },
  cueloop_pty_kill: { args: [FFIType.i32], returns: FFIType.i32 },
  cueloop_pty_get_pid: { args: [FFIType.i32], returns: FFIType.i32 },
  cueloop_pty_get_exit_code: { args: [FFIType.i32], returns: FFIType.i32 },
  cueloop_pty_close: { args: [FFIType.i32], returns: FFIType.void },
} as const;

type PtyLib = ReturnType<typeof dlopen<typeof PTY_SYMBOLS>>["symbols"];

/** The prebuilt pty shim for this platform, or null when none ships for it. */
function nativeLibraryPath(): string | null {
  const suffix = process.platform === "darwin" ? "dylib" : "so";
  const dir = `${process.platform}-${process.arch}`;
  const path = join(import.meta.dir, "..", "native", dir, `libcuelooppty.${suffix}`);
  return existsSync(path) ? path : null;
}

/** One shared load of the pty shim; null when no dylib ships for the platform. */
let ptyLib: PtyLib | null | undefined;
function library(): PtyLib | null {
  if (ptyLib !== undefined) return ptyLib;
  const path = nativeLibraryPath();
  if (!path) return (ptyLib = null);
  try {
    ptyLib = dlopen(path, PTY_SYMBOLS).symbols;
  } catch (error) {
    console.error(`cueloop: failed to load ${path}:`, error);
    ptyLib = null;
  }
  return ptyLib;
}

/** True when this platform ships a prebuilt pty shim (embedding is possible). */
export function ptyAvailable(): boolean {
  return library() !== null;
}

class EventEmitter<T> {
  private listeners: ((value: T) => void)[] = [];
  readonly event = (listener: (value: T) => void): Disposable => {
    this.listeners.push(listener);
    return {
      dispose: () => {
        const index = this.listeners.indexOf(listener);
        if (index !== -1) this.listeners.splice(index, 1);
      },
    };
  };
  fire(value: T): void {
    for (const listener of this.listeners) listener(value);
  }
}

/** Pack tokens into the C shim's "tok\0tok\0...\0\0" (double-NUL-terminated) form. */
function packTokens(tokens: string[]): Buffer {
  return Buffer.from(tokens.map((token) => `${token}\0`).join("") + "\0", "utf8");
}

class Pty implements IPty {
  private handle: number;
  private processId: number;
  private columns: number;
  private rowCount: number;
  private closing = false;
  private reading = false;
  private readonly decoder = new TextDecoder("utf-8");
  private readonly dataEvent = new EventEmitter<string>();
  private readonly exitEvent = new EventEmitter<ExitEvent>();

  constructor(
    private readonly lib: PtyLib,
    file: string,
    args: string[],
    options: PtyForkOptions,
  ) {
    this.columns = options.cols ?? DEFAULT_COLS;
    this.rowCount = options.rows ?? DEFAULT_ROWS;
    const cwd = options.cwd ?? process.cwd();
    const env = options.env
      ? Object.entries(options.env).map(([key, value]) => `${key}=${value}`)
      : [];

    const argvPacked = packTokens([file, ...args]);
    const envPacked = packTokens(env);
    this.handle = lib.cueloop_pty_spawn(
      ptr(argvPacked),
      Buffer.from(`${cwd}\0`, "utf8"),
      ptr(envPacked),
      this.columns,
      this.rowCount,
    );
    if (this.handle < 0) throw new Error("PTY spawn failed");
    this.processId = lib.cueloop_pty_get_pid(this.handle);
    // Let the caller attach onData/onExit before the first bytes arrive.
    queueMicrotask(() => void this.readLoop());
  }

  get pid(): number {
    return this.processId;
  }
  get cols(): number {
    return this.columns;
  }
  get rows(): number {
    return this.rowCount;
  }
  get onData() {
    return this.dataEvent.event;
  }
  get onExit() {
    return this.exitEvent.event;
  }

  write(data: string): void {
    if (this.closing) return;
    const buffer = Buffer.from(data, "utf8");
    this.lib.cueloop_pty_write(this.handle, ptr(buffer), buffer.length);
  }

  resize(cols: number, rows: number): void {
    if (this.closing) return;
    this.columns = cols;
    this.rowCount = rows;
    this.lib.cueloop_pty_resize(this.handle, cols, rows);
  }

  kill(): void {
    if (this.closing) return;
    this.closing = true;
    this.lib.cueloop_pty_kill(this.handle);
    this.lib.cueloop_pty_close(this.handle);
    this.exitEvent.fire({ exitCode: 0 });
  }

  private async readLoop(): Promise<void> {
    if (this.reading) return;
    this.reading = true;
    const buffer = Buffer.allocUnsafe(READ_BUFFER_BYTES);
    while (!this.closing) {
      const count = this.lib.cueloop_pty_read(this.handle, ptr(buffer), buffer.length);
      if (count > 0) {
        // Stream mode buffers a multibyte char split across reads (box-drawing etc.).
        const text = this.decoder.decode(buffer.subarray(0, count), { stream: true });
        if (text) this.dataEvent.fire(text);
      } else if (count === CHILD_EXITED || count < 0) {
        // Both the drained-exit sentinel and a hard read error end the session:
        // flush the decoder, reap for the code, close, and fire the exit once.
        const tail = this.decoder.decode();
        if (tail) this.dataEvent.fire(tail);
        const exitCode = this.lib.cueloop_pty_get_exit_code(this.handle);
        this.lib.cueloop_pty_close(this.handle);
        this.closing = true;
        this.exitEvent.fire({ exitCode });
      } else {
        await new Promise((resolve) => setTimeout(resolve, READ_IDLE_MS));
      }
    }
  }
}

/** Spawn `file` with `args` on a fresh PTY. Throws when no shim ships (gate on ptyAvailable). */
export function spawn(file: string, args: string[], options: PtyForkOptions = {}): IPty {
  const lib = library();
  if (!lib) throw new Error("cueloop: no pty shim for this platform");
  return new Pty(lib, file, args, options);
}
