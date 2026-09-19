// gh CLI reads for PR reviews; auth is delegated to the user's gh. Reads only.

const ghBinary = (): string => process.env.CUELOOP_GH || "gh";

async function gh(args: string[]): Promise<{ code: number; stdout: string }> {
  const process = Bun.spawn([ghBinary(), ...args], { stdout: "pipe", stderr: "ignore" });
  const stdout = await new Response(process.stdout).text();

  return { code: await process.exited, stdout };
}

/** The PR head commit sha, or null when gh is absent, unauthenticated, or the call fails. */
export async function prHeadSha(pr: string): Promise<string | null> {
  const { code, stdout } = await gh([
    "pr",
    "view",
    pr,
    "--json",
    "headRefOid",
    "-q",
    ".headRefOid",
  ]);

  if (code !== 0) return null;
  const sha = stdout.trim();

  return sha.length > 0 ? sha : null;
}

/** The PR unified diff as gh prints it, or null when the call fails. */
export async function prDiff(pr: string): Promise<string | null> {
  const { code, stdout } = await gh(["pr", "diff", pr]);

  if (code !== 0) return null;

  return stdout;
}
