import { DaemonClient } from "@cueloop/daemon/client";

/** Global harness flags never consume a session primitive's unrelated --harness argument. */
interface HarnessSelection {
  args: string[];
  harness?: "pi" | "fx";
}

export function parseHarnessSelection(args: readonly string[]): HarnessSelection {
  const remaining = [...args];
  const global = args[0]?.startsWith("--harness") || args[0] === "restart" || args[0] === "daemon";

  if (!global) return { args: remaining };
  const index = remaining.findIndex((arg) => arg === "--harness" || arg.startsWith("--harness="));

  if (index < 0) return { args: remaining };
  const flag = remaining[index]!;
  const value = flag === "--harness" ? remaining[index + 1] : flag.slice("--harness=".length);

  if (value !== "pi" && value !== "fx")
    throw new Error("Thread harness selection requires --harness pi or --harness fx");
  remaining.splice(index, flag === "--harness" ? 2 : 1);
  if (remaining.some((arg) => arg === "--harness" || arg.startsWith("--harness=")))
    throw new Error("Thread harness selection accepts only one --harness flag");

  return { args: remaining, harness: value };
}

/** A running daemon must confirm the requested default before a launcher opens its UI. */
export async function assertDaemonHarness(harness: "pi" | "fx"): Promise<void> {
  const client = await DaemonClient.connect({ autostart: true });

  try {
    const current = await client.ping();

    if (current.agentHarness !== harness)
      throw new Error(`Thread harness default mismatch. Run cueloop restart --harness ${harness}.`);
  } finally {
    client.close();
  }
}
