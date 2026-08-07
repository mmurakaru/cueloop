/**
 * Wire protocol (#14): newline-delimited JSON over the unix socket.
 * Requests: { id, method, params }  Responses: { id, result } | { id, error }
 * Events (push, after events.subscribe): { event, sessionId }
 */

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

/** Incremental NDJSON splitter; tolerates partial writes. */
export class LineBuffer {
  private buf = "";

  push(chunk: string, onLine: (line: string) => void): void {
    this.buf += chunk;
    for (;;) {
      const nl = this.buf.indexOf("\n");
      if (nl === -1) return;
      const line = this.buf.slice(0, nl).trim();
      this.buf = this.buf.slice(nl + 1);
      if (line) onLine(line);
    }
  }
}
