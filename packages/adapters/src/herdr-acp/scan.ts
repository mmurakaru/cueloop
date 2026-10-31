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
  seq: number;
  dir: "in" | "out";
  line: string;
}

export interface PromptScan {
  id: number;
  stopReason: string | null;
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
    sequence: Math.max(scan.sequence, record.seq, frame?.id ?? 0),
    cursor: record.dir === "out" ? record.seq : scan.cursor,
    prompt: scan.prompt,
  };

  if (!frame) return next;

  if (record.dir === "in") return foldInbound(next, frame);

  return foldOutbound(next, frame);
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
    scan.prompt = { id: frame.id, stopReason: null };
  }

  return scan;
}

function foldOutbound(scan: AcpScan, frame: LooseFrame): AcpScan {
  if (frame.result?.sessionId) scan.sessionId = frame.result.sessionId;

  if (
    scan.prompt &&
    frame.id === scan.prompt.id &&
    frame.result?.stopReason &&
    frame.method === undefined
  ) {
    scan.prompt = { id: scan.prompt.id, stopReason: frame.result.stopReason };
  }

  return scan;
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
