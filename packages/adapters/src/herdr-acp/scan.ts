import * as v from "valibot";

const FrameSchema = v.object({
  id: v.optional(v.number()),
  method: v.optional(v.string()),
  result: v.optional(
    v.nullable(
      v.object({
        sessionId: v.optional(v.string()),
        stopReason: v.optional(v.string()),
      }),
    ),
  ),
  params: v.optional(v.nullable(v.object({ sessionId: v.optional(v.string()) }))),
});

type LooseFrame = v.InferOutput<typeof FrameSchema>;

export interface TranscriptRecord {
  sequence: number;
  direction: "in" | "out";
  line: string;
}

export interface PromptScan {
  id: number;
  stopReason: string | null;
  /** Stdout sequence of the stop reason. Null while the prompt is still running. */
  answeredAt: number | null;
}

/** What a fresh client can recover from the relay's byte log. */
export interface AcpScan {
  sessionId: string | null;
  sequence: number;
  cursor: number;
  prompt: PromptScan | null;
}

export function emptyScan(): AcpScan {
  return { sessionId: null, sequence: 0, cursor: 0, prompt: null };
}

/** Fold one transcript record. Invalid lines still advance the cursor so resume cannot stall on them. */
export function foldRecord(scan: AcpScan, record: TranscriptRecord): AcpScan {
  const frame = parseLooseFrame(record.line);
  const next: AcpScan = {
    sessionId: scan.sessionId,
    sequence: Math.max(scan.sequence, record.sequence, frame?.id ?? 0),
    cursor: record.direction === "out" ? record.sequence : scan.cursor,
    prompt: scan.prompt,
  };

  if (!frame) return next;

  if (record.direction === "in") return foldInbound(next, frame);

  return foldOutbound(next, frame, record.sequence);
}

export function foldRecords(records: readonly TranscriptRecord[]): AcpScan {
  return records.reduce(foldRecord, emptyScan());
}

function foldInbound(scan: AcpScan, frame: LooseFrame): AcpScan {
  if (
    (frame.method === "session/load" || frame.method === "session/new") &&
    frame.params?.sessionId
  ) {
    scan.sessionId = frame.params.sessionId;
  }

  if (frame.method === "session/prompt" && frame.id !== undefined) {
    scan.prompt = { id: frame.id, stopReason: null, answeredAt: null };
  }

  return scan;
}

function foldOutbound(scan: AcpScan, frame: LooseFrame, sequence: number): AcpScan {
  if (frame.result?.sessionId) scan.sessionId = frame.result.sessionId;

  if (
    scan.prompt &&
    frame.id === scan.prompt.id &&
    frame.result?.stopReason &&
    frame.method === undefined
  ) {
    scan.prompt = {
      id: scan.prompt.id,
      stopReason: frame.result.stopReason,
      answeredAt: sequence,
    };
  }

  return scan;
}

/**
 * A finished prompt at or before the checkpoint belongs to an older turn.
 * The current turn is missing until its own prompt is on the transcript.
 */
export function promptStillOpen(prompt: PromptScan | null, cursor: number): boolean {
  if (!prompt) return false;

  if (prompt.answeredAt !== null && prompt.answeredAt <= cursor) return false;

  return true;
}

/**
 * Outbound requests the daemon already answered. Replaying them would run the tool again.
 * The match is the request sequence, so a later request can reuse the JSON-RPC id.
 */
export function answeredRequestSequences(records: readonly TranscriptRecord[]): Set<number> {
  const pending = new Map<number, number>();
  const answered = new Set<number>();

  for (const record of records) {
    const frame = parseLooseFrame(record.line);

    if (!frame || frame.id === undefined) continue;

    if (record.direction === "out" && frame.method) pending.set(frame.id, record.sequence);
    else if (record.direction === "in" && frame.method === undefined) {
      const sequence = pending.get(frame.id);

      if (sequence !== undefined) {
        answered.add(sequence);
        pending.delete(frame.id);
      }
    }
  }

  return answered;
}

function parseLooseFrame(line: string): LooseFrame | undefined {
  try {
    const parsed = v.safeParse(FrameSchema, JSON.parse(line));

    if (!parsed.success) return undefined;

    return parsed.output;
  } catch {
    return undefined;
  }
}
