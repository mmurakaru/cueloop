/**
 * Wire protocol: newline-delimited JSON over the unix socket.
 * Requests: { id, method, params }  Responses: { id, result } | { id, error }
 * Events (push, after events.subscribe): { event, sessionId }
 */

import * as v from "valibot";

export interface Request {
  id: number;
  method: string;
  params?: unknown;
}

export interface Response {
  id: number;
  result?: unknown;
  error?: { code: string; message: string };
}

export interface EventFrame {
  event: string;
  sessionId: string;
}

export type Frame = Response | EventFrame;

const RequestSchema = v.object({
  id: v.number(),
  method: v.string(),
  params: v.optional(v.unknown()),
});
const ResponseSchema = v.object({
  id: v.number(),
  result: v.optional(v.unknown()),
  error: v.optional(v.object({ code: v.string(), message: v.string() })),
});
const EventFrameSchema = v.object({
  event: v.string(),
  sessionId: v.string(),
});

export function parseRequestFrame(line: string): Request {
  return v.parse(RequestSchema, JSON.parse(line));
}

export function parseInboundFrame(line: string): Frame {
  return v.parse(v.union([ResponseSchema, EventFrameSchema]), JSON.parse(line));
}

/** Incremental NDJSON splitter; tolerates partial writes. */
export class LineBuffer {
  private buffered = "";

  push(chunk: string, onLine: (line: string) => void): void {
    this.buffered += chunk;
    for (;;) {
      const newlineIndex = this.buffered.indexOf("\n");

      if (newlineIndex === -1) return;
      const line = this.buffered.slice(0, newlineIndex).trim();

      this.buffered = this.buffered.slice(newlineIndex + 1);
      if (line) onLine(line);
    }
  }
}

/** The surface both Bun.listen and Bun.connect sockets satisfy. */
interface WritableSocket {
  write(data: Buffer): number;
}

/**
 * Outbound writes honoring socket backpressure. A frame larger than the
 * kernel buffer is written partially by the socket; the unwritten tail must
 * wait for the drain callback or the frame truncates mid-line and the NDJSON
 * stream corrupts for good. Frames never reorder: while a tail is pending,
 * new writes append behind it.
 */
export class BackpressureWriter {
  private pending: Buffer | null = null;

  constructor(private socket: WritableSocket) {}

  write(data: string): void {
    const bytes = Buffer.from(data, "utf8");

    if (this.pending) {
      this.pending = Buffer.concat([this.pending, bytes]);

      return;
    }
    const written = Math.max(0, this.socket.write(bytes));

    if (written < bytes.length) this.pending = bytes.subarray(written);
  }

  /** Call from the socket's drain handler. */
  drain(): void {
    if (!this.pending) return;
    const tail = this.pending;

    this.pending = null;
    const written = Math.max(0, this.socket.write(tail));

    if (written < tail.length) this.pending = tail.subarray(written);
  }
}
