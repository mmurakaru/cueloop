/** Check agent behavior proofs, generated JS agreement, and rejected mutations. */
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

import { agentInputTarget } from "../packages/schema/src/agent-input";
import {
  stepAgentSubmission,
  type AgentSubmissionStatus,
  type AgentSubmissionEvent,
} from "../packages/schema/src/agent-submission";

const proofArgs = process.env.CUELOOP_BEND_VERDICT === "0" ? [] : ["--verdict"];
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
  const proof = runBend(join(source, "PROOF.bend"), proofArgs);

  if (!proof.includes("ALL PROOFS CHECK") || proof.includes("SOME PROOFS FAIL"))
    throw new Error(`Agent laws were not verified: ${proof}`);
  console.log("Bend proof check: ALL PROOFS CHECK (2 recovery laws)");
  const submissionSource = join(import.meta.dirname, "../examples/agent-submission");
  const submissionPath = join(scratch, "submission.mjs");

  runBend(join(submissionSource, "submission.bend"), ["-o", submissionPath]);
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
  const submissionProof = runBend(join(submissionSource, "PROOF.bend"), proofArgs);

  if (!submissionProof.includes("ALL PROOFS CHECK") || submissionProof.includes("SOME PROOFS FAIL"))
    throw new Error(`Submission laws were not verified: ${submissionProof}`);

  const submissionModule = v.parse(
    v.object({ default: v.object({ step: v.function(), input_target: v.function() }) }),
    await import(pathToFileURL(submissionPath).href),
  );
  const inputNames = { prompt: "PromptInput", comment: "CommentInput", none: "NoInput" };

  for (const atPrompt of [false, true])
    for (const selected of [false, true]) {
      const actual: unknown = submissionModule.default.input_target(atPrompt, selected);

      deepStrictEqual(actual, { $: inputNames[agentInputTarget(atPrompt, selected)] });
    }
  console.log(
    "Input routing proof: 3 laws checked; all 4 TypeScript input cases match generated Bend JS",
  );
  const submissionStates: AgentSubmissionStatus[] = [
    "draft",
    "queued",
    "running",
    "completed",
    "failed",
  ];
  const submissionEvents: AgentSubmissionEvent[] = [
    "submit",
    "start",
    "complete",
    "fail",
    "retry",
    "edit",
  ];
  const statusNames = {
    draft: "Draft",
    queued: "Queued",
    running: "Running",
    completed: "Completed",
    failed: "Failed",
  };
  const submissionEventNames = {
    submit: "Submit",
    start: "Start",
    complete: "Complete",
    fail: "FailTurn",
    retry: "Retry",
    edit: "Edit",
  };
  let submissionTransitions = 0;
  const compareSubmissions = (status: AgentSubmissionStatus, depth: number): void => {
    if (!depth) return;
    for (const event of submissionEvents)
      for (const hasInput of [false, true]) {
        const expected = stepAgentSubmission(status, event, hasInput);
        const actual: unknown = submissionModule.default.step(
          { $: submissionEventNames[event] },
          { $: statusNames[status] },
          hasInput,
        );

        deepStrictEqual(actual, { $: statusNames[expected] });
        submissionTransitions++;
        compareSubmissions(expected, depth - 1);
      }
  };

  for (const status of submissionStates) compareSubmissions(status, 4);
  console.log(
    `Submission proof: 10 laws checked; generated JS matches ${submissionTransitions} TypeScript transitions`,
  );
  const submissionScratch = join(scratch, "submission-proof");
  const { mkdirSync } = await import("node:fs");

  mkdirSync(submissionScratch);
  for (const file of ["LAWS.bend", "PROOF.bend"])
    copyFileSync(join(submissionSource, file), join(submissionScratch, file));
  const emptyMutation = readFileSync(join(submissionSource, "submission.bend"), "utf8").replace(
    "case False{}: Draft{}",
    "case False{}: Queued{}",
  );

  writeFileSync(join(submissionScratch, "submission.bend"), emptyMutation);
  const rejected = Bun.spawnSync([bend, join(submissionScratch, "PROOF.bend"), ...proofArgs], {
    env: { ...process.env, BEND_NO_TELEMETRY: "1" },
    stdout: "pipe",
    stderr: "pipe",
  });
  const emptyVerdict = rejected.stdout.toString() + rejected.stderr.toString();

  if (!emptyVerdict.includes("SOME PROOFS FAIL"))
    throw new Error("Submission law failed to reject an empty-input invocation");
  console.log("Mutation rejected: empty input cannot enqueue an invocation");
  const inputMutation = readFileSync(join(submissionSource, "submission.bend"), "utf8").replace(
    "case True{}: PromptInput{}",
    "case True{}: CommentInput{}",
  );

  writeFileSync(join(submissionScratch, "submission.bend"), inputMutation);
  const inputRejected = Bun.spawnSync([bend, join(submissionScratch, "PROOF.bend"), ...proofArgs], {
    env: { ...process.env, BEND_NO_TELEMETRY: "1" },
    stdout: "pipe",
    stderr: "pipe",
  });
  const inputVerdict = inputRejected.stdout.toString() + inputRejected.stderr.toString();

  if (!inputVerdict.includes("SOME PROOFS FAIL"))
    throw new Error("Input law failed to reject treating a bottom prompt as a comment");
  console.log("Mutation rejected: bottom prompts cannot become comments");
  for (const file of ["LAWS.bend", "PROOF.bend"])
    copyFileSync(join(source, file), join(scratch, file));
  const original = readFileSync(join(source, "turn.bend"), "utf8");
  const broken = original.replace("case True{}: Idle{}", "case True{}: Starting{True{}}");

  if (broken === original)
    throw new Error("Agent law mutation did not change the cancellation transition");
  writeFileSync(join(scratch, "turn.bend"), broken);
  const mutation = Bun.spawnSync([bend, join(scratch, "PROOF.bend"), ...proofArgs], {
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
