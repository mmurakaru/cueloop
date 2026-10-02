/** The signed-in GitHub identity from the local gh tool, or null when gh cannot answer. */

import * as v from "valibot";

export interface GithubIdentity {
  login: string;
  name?: string;
}

const GithubUserSchema = v.object({
  login: v.string(),
  name: v.nullish(v.string()),
});

/** The gh binary is injectable so tests stub it without a real GitHub login. */
function githubCliBinary(): string {
  return process.env.CUELOOP_GH || "gh";
}

/** Read the authenticated GitHub login and name, or null when gh cannot answer. */
export async function resolveGithubIdentity(): Promise<GithubIdentity | null> {
  try {
    const githubProcess = Bun.spawn(
      [githubCliBinary(), "api", "user", "--jq", "{login: .login, name: .name}"],
      { stdout: "pipe", stderr: "ignore" },
    );
    const [output, exitCode] = await Promise.all([
      new Response(githubProcess.stdout).text(),
      githubProcess.exited,
    ]);

    if (exitCode !== 0) return null;
    const parsed = v.safeParse(GithubUserSchema, JSON.parse(output));

    if (!parsed.success) return null;

    return { login: parsed.output.login, name: parsed.output.name ?? undefined };
  } catch {
    return null;
  }
}
