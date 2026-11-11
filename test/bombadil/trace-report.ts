import {
  BOMBADIL_READY_TITLE,
  BOMBADIL_DRAFT_TEXT,
  type BombadilScenario,
} from "./fixture-contract.ts";
import { createHash } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { rm } from "node:fs/promises";
import { createInterface } from "node:readline";
import { pipeline } from "node:stream/promises";
import { createGzip } from "node:zlib";
import * as valibot from "valibot";

const TraceEntrySchema = valibot.object({
  action: valibot.nullable(
    valibot.union([
      valibot.object({ TypeText: valibot.object({ text: valibot.string() }) }),
      valibot.object({
        Resize: valibot.object({
          size: valibot.object({ columns: valibot.number(), rows: valibot.number() }),
        }),
      }),
      valibot.object({
        Click: valibot.object({ row: valibot.number(), column: valibot.number() }),
      }),
      valibot.object({ ScrollUp: valibot.object({}) }),
      valibot.object({ ScrollDown: valibot.object({}) }),
    ]),
  ),
  snapshots: valibot.array(
    valibot.object({
      name: valibot.optional(valibot.nullable(valibot.string())),
      value: valibot.unknown(),
    }),
  ),
  violations: valibot.array(valibot.object({ name: valibot.string() })),
});
const ScreenSnapshotSchema = valibot.object({
  text: valibot.string(),
  rows: valibot.number(),
  columns: valibot.number(),
});

export interface BombadilTraceSummary {
  states: number;
  actions: number;
  keys: number;
  clicks: number;
  resizes: number;
  unicodeInputs: number;
  readyStates: number;
  sizes: string[];
  violations: string[];
}

export function bombadilPropertiesPassed(
  trace: BombadilTraceSummary | null,
  scenario: BombadilScenario,
  exitCode: number | null,
): boolean {
  if (!trace) return false;

  if (scenario === "negative-control") {
    return (
      exitCode === 1 &&
      trace.violations.length === 1 &&
      trace.violations[0] === "noReplacementChars"
    );
  }

  return (
    exitCode === 0 &&
    trace.violations.length === 0 &&
    trace.actions >= 10 &&
    trace.readyStates >= 10 &&
    trace.resizes > 0 &&
    (scenario === "draft" ? trace.unicodeInputs > 0 : trace.clicks > 0)
  );
}

export async function summarizeBombadilTrace(path: string) {
  const summary: BombadilTraceSummary = {
    states: 0,
    actions: 0,
    keys: 0,
    clicks: 0,
    resizes: 0,
    unicodeInputs: 0,
    readyStates: 0,
    sizes: [],
    violations: [],
  };
  const sizes = new Set<string>();
  const violations = new Set<string>();
  const input = createReadStream(path);
  const lines = createInterface({ input, crlfDelay: Infinity });

  try {
    for await (const line of lines) {
      const entry = valibot.parse(TraceEntrySchema, JSON.parse(line));

      summary.states += 1;

      for (const violation of entry.violations) violations.add(violation.name);

      for (const snapshot of entry.snapshots) {
        if (snapshot.name !== "reviewScreen") continue;

        const screen = valibot.parse(ScreenSnapshotSchema, snapshot.value);

        sizes.add(`${screen.columns}x${screen.rows}`);

        if (screen.text.includes(BOMBADIL_READY_TITLE)) summary.readyStates += 1;
      }

      const action = entry.action;

      if (!action) continue;

      if ("TypeText" in action) {
        if (action.TypeText.text.length === 0) continue;

        summary.keys += 1;

        if (action.TypeText.text.includes(BOMBADIL_DRAFT_TEXT)) summary.unicodeInputs += 1;
      } else if ("Resize" in action) {
        summary.resizes += 1;
      } else if ("Click" in action) {
        summary.clicks += 1;
      }

      summary.actions += 1;
    }
  } finally {
    lines.close();
    input.destroy();
  }

  summary.sizes = [...sizes].toSorted();
  summary.violations = [...violations].toSorted();

  return summary;
}

export async function compressBombadilTrace(path: string) {
  const target = `${path}.gz`;

  await pipeline(createReadStream(path), createGzip(), createWriteStream(target));
  const digest = createHash("sha256");

  for await (const chunk of createReadStream(target)) digest.update(chunk);

  await rm(path);

  return { path: target, sha256: digest.digest("hex") };
}
