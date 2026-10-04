/** Check the lifecycle proof, its generated JS, and a mutation that restores the stale cancellation bug. */
import { mkdtempSync, rmSync, copyFileSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { deepStrictEqual } from "node:assert";
import * as v from "valibot";
import {
  stepAgentTurn,
  type AgentTurn,
  type AgentTurnEvent,
} from "../packages/daemon/src/agent-turn";

const bend = process.env.BEND_BIN ?? "bend";
const source = join(import.meta.dirname, "../examples/agent-lifecycle");
const scratch = mkdtempSync(join(tmpdir(), "cueloop-agent-laws-"));
const BendTurnSchema = v.variant("$", [
  v.object({ $: v.literal("Idle") }),
  v.object({ $: v.literal("Starting"), cancelled: v.boolean() }),
  v.object({ $: v.literal("Running") }),
  v.object({ $: v.literal("Stopping") }),
]);
type BendTurn = v.InferOutput<typeof BendTurnSchema>;
const states: AgentTurn[] = [
  { kind: "idle" },
  { kind: "starting", cancelled: false },
  { kind: "starting", cancelled: true },
  { kind: "running" },
  { kind: "stopping" },
];
const events: AgentTurnEvent[] = ["start", "ready", "stop", "finished"];
const eventNames = { start: "Start", ready: "Ready", stop: "Stop", finished: "Finished" };

function runBend(file: string, args: string[]): string {
  const result = Bun.spawnSync([bend, file, ...args], {
    env: { ...process.env, BEND_NO_TELEMETRY: "1" },
    stdout: "pipe",
    stderr: "pipe",
  });
  const output = result.stdout.toString() + result.stderr.toString();

  if (result.exitCode !== 0) throw new Error(`Agent law checker failed: ${output}`);

  return output;
}

function toBendTurn(state: AgentTurn): BendTurn {
  switch (state.kind) {
    case "idle":
      return { $: "Idle" };
    case "starting":
      return { $: "Starting", cancelled: state.cancelled };
    case "running":
      return { $: "Running" };
    case "stopping":
      return { $: "Stopping" };
  }
}

try {
  const proof = runBend(join(source, "PROOF.bend"), ["--verdict"]);

  if (!proof.includes("ALL PROOFS CHECK") || proof.includes("SOME PROOFS FAIL"))
    throw new Error(`Agent laws were not verified: ${proof}`);
  console.log("Independent Bend verdict: ALL PROOFS CHECK (2 recovery laws)");
  const modulePath = join(scratch, "turn.mjs");

  runBend(join(source, "turn.bend"), ["-o", modulePath]);
  const generated = v.parse(
    v.object({ default: v.object({ step: v.function() }) }),
    await import(pathToFileURL(modulePath).href),
  );
  let compared = 0;
  const compareTraces = (state: AgentTurn, depth: number): void => {
    if (depth === 0) return;
    for (const event of events) {
      const expected = stepAgentTurn(state, event);
      const actual = v.parse(
        BendTurnSchema,
        generated.default.step({ $: eventNames[event] }, toBendTurn(state)),
      );

      deepStrictEqual(actual, toBendTurn(expected));
      compared++;
      compareTraces(expected, depth - 1);
    }
  };

  for (const state of states) compareTraces(state, 6);
  console.log(
    `Generated Bend JS matches the daemon reducer on ${compared} transitions across all traces up to 6 events from all 5 states`,
  );
  for (const file of ["LAWS.bend", "PROOF.bend"])
    copyFileSync(join(source, file), join(scratch, file));
  const original = readFileSync(join(source, "turn.bend"), "utf8");
  const broken = original.replace("case True{}: Idle{}", "case True{}: Starting{True{}}");

  if (broken === original)
    throw new Error("Agent law mutation did not change the cancellation transition");
  writeFileSync(join(scratch, "turn.bend"), broken);
  const mutation = Bun.spawnSync([bend, join(scratch, "PROOF.bend"), "--verdict"], {
    env: { ...process.env, BEND_NO_TELEMETRY: "1" },
    stdout: "pipe",
    stderr: "pipe",
  });
  const output = mutation.stdout.toString() + mutation.stderr.toString();

  if (!output.includes("SOME PROOFS FAIL") || output.includes("ALL PROOFS CHECK"))
    throw new Error(`Agent law mutation was not rejected: ${output}`);
  console.log(
    "Mutation rejected: leaving cancellation set after readiness breaks the recovery proof",
  );
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
