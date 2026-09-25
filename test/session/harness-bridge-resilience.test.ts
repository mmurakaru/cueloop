import { describe, expect, test } from "bun:test";
import { join } from "node:path";

const ENTRY = join(import.meta.dir, "..", "..", "packages", "cli", "src", "main.ts");

async function runBridgeProcess(
  payload: string,
): Promise<{ out: string; error: string; code: number }> {
  const proc = Bun.spawn([process.execPath, "run", ENTRY, "harness"], {
    stdin: new TextEncoder().encode(payload),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [out, error, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);

  return { out, error, code };
}

describe("harness bridge request validation", () => {
  test("malformed JSON fails without a success response", async () => {
    const result = await runBridgeProcess("not json");

    expect(result.code).toBe(1);
    expect(result.out).toBe("");
    expect(result.error).toContain("cueloop harness bridge failed");
  });

  test("a wrong operation fails before daemon startup", async () => {
    const result = await runBridgeProcess(JSON.stringify({ operation: "discard" }));

    expect(result.code).toBe(1);
    expect(result.out).toBe("");
    expect(result.error).toContain("cueloop harness bridge failed");
  });
});
