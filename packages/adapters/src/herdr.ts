import { type HerdrEnv, detectHerdr } from "@cueloop/schema";
import { spawn } from "node:child_process";

export type HerdrAgentState = "blocked" | "working" | "done" | "idle";

const SOURCE = "custom:cueloop";
const LABEL_TTL_MS = 3_600_000;

/** Report semantic agent state for this pane. No-op outside herdr. */
export function reportState(state: HerdrAgentState, env: HerdrEnv = process.env): void {
  const herdr = detectHerdr(env);

  if (!herdr) return;
  spawnQuiet([
    herdr.binPath,
    "pane",
    "report-agent",
    herdr.paneId,
    "--source",
    SOURCE,
    "--state",
    state,
  ]);
}

/** Report a sidebar metadata label for this pane. No-op outside herdr. */
export function reportLabel(text: string, env: HerdrEnv = process.env): void {
  const herdr = detectHerdr(env);

  if (!herdr) return;
  spawnQuiet([
    herdr.binPath,
    "pane",
    "report-metadata",
    herdr.paneId,
    "--source",
    SOURCE,
    "--token",
    `summary=${text}`,
    "--ttl-ms",
    String(LABEL_TTL_MS),
  ]);
}

function spawnQuiet(command: string[]): void {
  try {
    const child = spawn(command[0]!, command.slice(1), { stdio: "ignore" });

    child.on("error", () => {});
    child.unref();
  } catch {
    // best-effort reporting: a missing or broken binary is not our failure
  }
}
