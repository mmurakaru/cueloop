// gh CLI reads for PR reviews; auth is delegated to the user's gh. Reads only.

import * as v from "valibot";

export interface PullRequestRefs {
  baseSha: string;
  headSha: string;
}

const PullRequestRefsSchema = v.object({
  baseRefOid: v.pipe(v.string(), v.nonEmpty()),
  headRefOid: v.pipe(v.string(), v.nonEmpty()),
});

const ghBinary = (): string => process.env.CUELOOP_GH || "gh";

async function gh(args: string[]): Promise<{ code: number; stdout: string }> {
  const process = Bun.spawn([ghBinary(), ...args], { stdout: "pipe", stderr: "ignore" });
  const stdout = await new Response(process.stdout).text();

  return { code: await process.exited, stdout };
}

/** The PR base and head commits, or null when gh is absent, unauthenticated, or the call fails. */
export async function prRefs(pr: string): Promise<PullRequestRefs | null> {
  const { code, stdout } = await gh(["pr", "view", pr, "--json", "baseRefOid,headRefOid"]);

  if (code !== 0) return null;
  let input: unknown;

  try {
    input = JSON.parse(stdout);
  } catch {
    return null;
  }
  const parsed = v.safeParse(PullRequestRefsSchema, input);

  if (!parsed.success) return null;

  return { baseSha: parsed.output.baseRefOid, headSha: parsed.output.headRefOid };
}

/** The PR unified diff as gh prints it, or null when the call fails. */
export async function prDiff(pr: string): Promise<string | null> {
  const { code, stdout } = await gh(["pr", "diff", pr]);

  if (code !== 0) return null;

  return stdout;
}

/** A stable PR diff and the exact base/head pair it represents. */
export async function prSnapshot(
  pr: string,
  attempts = 3,
  readRefs: (reference: string) => Promise<PullRequestRefs | null> = prRefs,
  readDiff: (reference: string) => Promise<string | null> = prDiff,
): Promise<{ patch: string; baseSha: string; headSha: string } | null> {
  for (let attempt = 0; attempt < attempts; attempt++) {
    const before = await readRefs(pr);

    if (before === null) return null;
    const patch = await readDiff(pr);

    if (patch === null) return null;
    const after = await readRefs(pr);

    if (after === null) return null;
    if (before.baseSha === after.baseSha && before.headSha === after.headSha)
      return { patch, ...after };
  }

  return null;
}
