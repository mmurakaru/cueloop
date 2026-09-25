/**
 * Post-publish verification: prove that what the registry now serves is
 * actually installable and runnable. The first alpha taught the lesson - the
 * publish tool reported success for packages that never reached the registry,
 * and the CLI it did publish could not install. Success is what a stranger
 * can install, not what a tool logged.
 *
 * Runs at the end of the release lane. A failure here fails the release run so
 * the breakage is loud instead of discovered by the first user.
 */

import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WORKFLOW_KINDS } from "@cueloop/schema";
import * as v from "valibot";

const RegistryDocSchema = v.object({
  versions: v.optional(v.record(v.string(), v.unknown())),
  "dist-tags": v.optional(v.record(v.string(), v.string())),
});

const releasePackage: { version: string } = await Bun.file("packages/cli/package.json").json();
const version = releasePackage.version;
const tag = version.includes("-") ? (version.split("-")[1] ?? "").split(".")[0] : "latest";

const names: string[] = [];

for (const glob of ["packages/*/package.json", "packages/integrations/*/package.json"]) {
  for await (const path of new Bun.Glob(glob).scan(".")) {
    const pkg: { name: string; private?: boolean } = await Bun.file(path).json();

    if (!pkg.private) names.push(pkg.name);
  }
}

/**
 * The registry is served through a CDN, so a read moments after a publish or a
 * retag can still return the previous document - that is how the alpha.3 run
 * reported a stale tag one second after retagging it. Every registry assertion
 * polls until it holds or the deadline passes: a stale read must not look like
 * a broken release, and a genuinely broken one must still fail.
 */
const PROPAGATION_TIMEOUT_MS = 180_000;
const POLL_INTERVAL_MS = 5_000;

async function settle(check: () => Promise<string | null>): Promise<string | null> {
  const deadline = Date.now() + PROPAGATION_TIMEOUT_MS;

  for (;;) {
    const problem = await check();

    if (problem === null) return null;
    if (Date.now() >= deadline) return problem;
    await Bun.sleep(POLL_INTERVAL_MS);
  }
}

const fresh = (url: string) =>
  fetch(url, { headers: { "cache-control": "no-cache", pragma: "no-cache" } });

const problems: string[] = [];

async function publishedPiLoads(
  executable: string,
  work: string,
  piHome: string,
): Promise<boolean> {
  const probePath = join(work, "pi-extension-probe.ts");
  const toolsPath = join(work, "pi-extension-tools.json");

  writeFileSync(
    probePath,
    `import { writeFileSync } from "node:fs";
export default function (pi: any) {
  pi.registerCommand("cueloop-extension-probe", {
    handler: async () => writeFileSync(${JSON.stringify(toolsPath)}, JSON.stringify(pi.getAllTools().map((tool: any) => tool.name))),
  });
}
`,
  );
  const host = Bun.spawn(
    [executable, "--mode", "rpc", "--offline", "--no-session", "-e", probePath],
    {
      cwd: work,
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
      env: {
        ...process.env,
        PI_CODING_AGENT_DIR: piHome,
        PI_OFFLINE: "1",
        CUELOOP_HOME: join(work, "pi-state"),
        CUELOOP_EXECUTABLE: join(work, "missing-cueloop"),
        CUELOOP_START_TIMEOUT_MS: "100",
      },
    },
  );

  try {
    // SAFETY: Bun.spawn receives "pipe" for stdin above.
    const input = host.stdin as Bun.FileSink;

    input.write('{"type":"get_commands"}\n');
    input.write('{"type":"prompt","message":"/cueloop-extension-probe"}\n');
    await input.flush();
    input.end();
    const timeout = setTimeout(() => host.kill(), 15_000);
    const exitCode = await host.exited.finally(() => clearTimeout(timeout));
    if (exitCode !== 0 || !existsSync(toolsPath)) return false;
    const output = await new Response(host.stdout).text();
    const commandLine = output
      .split("\n")
      .find((line) => line.includes('"command":"get_commands"'));

    if (!commandLine) return false;
    const commands = v.parse(
      v.object({
        success: v.literal(true),
        data: v.object({ commands: v.array(v.object({ name: v.string() })) }),
      }),
      JSON.parse(commandLine),
    ).data.commands;
    const commandNames = new Set(commands.map(({ name }) => name));
    const toolNames = v.parse(v.array(v.string()), JSON.parse(readFileSync(toolsPath, "utf8")));

    return (
      toolNames.includes("open_thread") &&
      WORKFLOW_KINDS.every(
        (workflow) =>
          commandNames.has(`cueloop:${workflow}`) && commandNames.has(`skill:cueloop-${workflow}`),
      )
    );
  } finally {
    host.kill();
    await host.exited;
  }
}

// 1. every package must be visible on the registry at this exact version
for (const name of new Set(names)) {
  const problem = await settle(async () => {
    const response = await fresh(`https://registry.npmjs.org/${name.replace("/", "%2F")}`);

    if (!response.ok)
      return `${name}: not on the registry (HTTP ${response.status}) - the publish did not land`;
    const doc = v.parse(RegistryDocSchema, await response.json());

    if (!doc.versions?.[version]) {
      return `${name}: registry has no ${version} (tags: ${JSON.stringify(doc["dist-tags"] ?? {})})`;
    }

    return null;
  });

  if (problem) problems.push(problem);
}

// 2. the dist-tag users are told to install must resolve to this release
if (problems.length === 0) {
  const problem = await settle(async () => {
    // the dedicated dist-tags endpoint reflects a retag sooner than the full doc
    const response = await fresh("https://registry.npmjs.org/-/package/cueloop/dist-tags");
    const tags: Record<string, string> = response.ok ? await response.json() : {};
    const tagged = tags[tag];

    return tagged === version
      ? null
      : `the "${tag}" dist-tag points at ${tagged ?? "nothing"}, not ${version} - "npm i cueloop@${tag}" would serve the wrong build`;
  });

  if (problem) problems.push(problem);
}

// 3. the CLI must install from the registry, by tag, and run
if (problems.length === 0) {
  const work = mkdtempSync(join(tmpdir(), "cueloop-verify-"));

  try {
    Bun.spawnSync(["npm", "init", "-y"], { cwd: work });
    // install by TAG: that is the command the docs give a stranger
    const install = Bun.spawnSync(
      ["npm", "install", `cueloop@${tag}`, "--no-audit", "--no-fund", "--prefer-online"],
      { cwd: work },
    );

    if (install.exitCode !== 0) {
      problems.push(
        `cueloop@${tag} does not install: ${install.stderr.toString().trim().split("\n").slice(-3).join(" ")}`,
      );
    } else {
      const entry = join(work, "node_modules", "cueloop", "src", "main.ts");
      const run = Bun.spawnSync([process.execPath, "run", entry, "help"], { cwd: work });
      const out = run.stdout.toString();

      if (run.exitCode !== 0 || !out.includes("cueloop session")) {
        problems.push(
          `the installed CLI does not run: exit ${run.exitCode}, stderr ${run.stderr.toString().trim().slice(0, 200)}`,
        );
      }
    }
    const piHome = join(work, "pi-agent");
    const globalPrefix = Bun.spawnSync(["npm", "prefix", "-g"]).stdout.toString().trim();
    const piExecutable = join(globalPrefix, "bin", "pi");

    if (!existsSync(piExecutable)) throw new Error(`pi host is not installed at ${piExecutable}`);
    const piInstall = Bun.spawnSync([piExecutable, "install", `npm:@cueloop/pi@${version}`], {
      cwd: work,
      env: { ...process.env, PI_CODING_AGENT_DIR: piHome },
    });

    if (piInstall.exitCode !== 0) {
      problems.push(
        `@cueloop/pi@${version} does not install in pi: ${piInstall.stderr.toString().trim().slice(-500)}`,
      );
    } else {
      const piList = Bun.spawnSync([piExecutable, "list"], {
        cwd: work,
        env: { ...process.env, PI_CODING_AGENT_DIR: piHome },
      });

      if (piList.exitCode !== 0 || !piList.stdout.toString().includes("@cueloop/pi")) {
        problems.push(`pi did not list the installed @cueloop/pi@${version} package`);
      } else if (!(await publishedPiLoads(piExecutable, work, piHome))) {
        problems.push(`pi did not load the published @cueloop/pi@${version} extension`);
      }
    }
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

if (problems.length) {
  console.error(`published release ${version} (tag ${tag}) is NOT usable:`);
  for (const problem of problems) console.error(`  - ${problem}`);
  process.exit(1);
}
console.log(`verified: ${version} (tag ${tag}) is on the registry and the CLI installs and runs`);
