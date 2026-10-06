import { spawn } from "bun";

let cancellation = new AbortController();

export function cancelMirrorRun(): void {
  cancellation.abort(new Error("Gateway mirror cancelled"));
}

export function finishMirrorRun(): void {
  cancellation = new AbortController();
}

export async function runMirrorCommand(argv: string[], timeoutMs = 180_000): Promise<Buffer> {
  cancellation.signal.throwIfAborted();
  const child = spawn(argv, { stdout: "pipe", stderr: "pipe" });
  const signal = cancellation.signal;
  const cancel = () => child.kill();
  const stdout = new Response(child.stdout).arrayBuffer();
  const stderr = new Response(child.stderr).text();
  const timer = setTimeout(() => child.kill(), timeoutMs);

  signal.addEventListener("abort", cancel, { once: true });
  try {
    const code = await child.exited;
    const output = Buffer.from(await stdout);
    const diagnostic = await stderr;

    signal.throwIfAborted();
    if (code !== 0)
      throw new Error(
        `Gateway mirror command failed (${code}): ${argv.join(" ")}\n${diagnostic}\n${output}`,
      );

    return output;
  } finally {
    clearTimeout(timer);
    signal.removeEventListener("abort", cancel);
  }
}

export async function waitForMirrorCondition(
  label: string,
  predicate: () => boolean | Promise<boolean>,
  timeoutMs = 30_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown;

  while (Date.now() < deadline) {
    cancellation.signal.throwIfAborted();
    try {
      if (await predicate()) return;
    } catch (error) {
      lastError = error;
    }
    await Bun.sleep(50);
  }
  throw new Error(`Gateway mirror timed out waiting for ${label}`, { cause: lastError });
}
