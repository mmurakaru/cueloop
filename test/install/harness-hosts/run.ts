import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { WORKFLOW_KINDS } from "@cueloop/schema";
import * as v from "valibot";

const REPO_ROOT = resolve(import.meta.dir, "../../..");
const HostPinsSchema = v.object({ claude: v.string(), codex: v.string(), pi: v.string() });
const hostVersions = v.parse(
  HostPinsSchema,
  await Bun.file(join(import.meta.dir, "pins.json")).json(),
);
const validateOnly = process.argv.includes("--validate-only");
const localSmoke = process.argv.includes("--local-smoke");

function runHostCommand(args: [string, ...string[]], cwd = REPO_ROOT): string {
  const executable =
    args[0] === "claude"
      ? hostExecutables.claude
      : args[0] === "codex"
        ? hostExecutables.codex
        : args[0] === "pi"
          ? hostExecutables.pi
          : args[0];
  const result = Bun.spawnSync([executable, ...args.slice(1)], { cwd, env: hostEnv });
  const output = result.stdout.toString();

  if (result.exitCode !== 0) {
    throw new Error(
      `${args.join(" ")} failed: ${output.trim()} ${result.stderr.toString().trim()}`,
    );
  }

  return output;
}

function checkInstalledSkills(root: string, harness: string): void {
  for (const workflow of WORKFLOW_KINDS) {
    if (!existsSync(join(root, "skills", workflow, "SKILL.md"))) {
      throw new Error(`${harness} installation does not expose ${workflow}`);
    }
  }
}

async function inspectPiExtension(work: string): Promise<void> {
  const workflowInventory = join(work, "pi-workflows.json");
  const processHandle = Bun.spawn(
    [
      hostExecutables.pi,
      "--mode",
      "rpc",
      "--offline",
      "--no-session",
      "--no-extensions",
      "--no-skills",
      "-e",
      join(REPO_ROOT, "packages/pi/extension.ts"),
      "-e",
      join(import.meta.dir, "pi-workflow-inventory.ts"),
    ],
    {
      cwd: work,
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
      env: {
        ...process.env,
        PI_OFFLINE: "1",
        PI_CODING_AGENT_DIR: join(work, "pi-agent"),
        CUELOOP_HOME: join(work, "cueloop-state"),
        CUELOOP_EXECUTABLE: join(work, "missing-cueloop"),
        CUELOOP_START_TIMEOUT_MS: "100",
        CUELOOP_TEST_PI_WORKFLOWS_FILE: workflowInventory,
      },
    },
  );

  try {
    // SAFETY: Bun.spawn receives "pipe" for stdin above.
    const input = processHandle.stdin as Bun.FileSink;

    input.write('{"type":"get_commands"}\n');
    input.write('{"type":"prompt","message":"/cueloop-smoke"}\n');
    await input.flush();
    input.end();
    let timedOut = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      processHandle.kill();
    }, 15_000);
    const exitCode = await processHandle.exited.finally(() => clearTimeout(timeout));

    if (timedOut) throw new Error("pi RPC did not exit in 15 seconds");
    const output = await new Response(processHandle.stdout).text();
    if (exitCode !== 0) {
      throw new Error(
        `pi RPC exited with code ${exitCode}: ${output} ${await new Response(processHandle.stderr).text()}`,
      );
    }
    const line = output.split("\n").find((entry) => entry.includes('"command":"get_commands"'));

    if (!line) throw new Error(`pi RPC did not list commands: ${output}`);
    const message = v.parse(
      v.object({
        command: v.literal("get_commands"),
        success: v.literal(true),
        data: v.object({ commands: v.array(v.object({ name: v.string() })) }),
      }),
      JSON.parse(line),
    );

    const commandNames = message.data.commands.map((command) => command.name);

    if (commandNames.includes("threads")) {
      throw new Error("pi still registers the cueloop Threads command");
    }
    for (const workflow of WORKFLOW_KINDS) {
      if (!commandNames.includes(`cueloop:${workflow}`)) {
        throw new Error(`pi did not register /cueloop:${workflow}`);
      }
    }
    if (!existsSync(workflowInventory)) throw new Error("pi did not invoke the workflow probe");
    const tools = v.parse(
      v.array(
        v.object({
          name: v.string(),
          parameters: v.optional(
            v.object({ properties: v.optional(v.record(v.string(), v.unknown())) }),
          ),
        }),
      ),
      JSON.parse(readFileSync(workflowInventory, "utf8")),
    );

    const openThread = tools.find((tool) => tool.name === "open_thread");
    const workflow = openThread?.parameters?.properties?.workflow;
    const enumValues = v.parse(v.object({ enum: v.array(v.string()) }), workflow).enum;

    if (JSON.stringify(enumValues) !== JSON.stringify(WORKFLOW_KINDS)) {
      throw new Error(`pi workflows differ from the shared contract: ${enumValues.join(", ")}`);
    }
  } finally {
    processHandle.kill();
    await processHandle.exited;
  }
}

const work = mkdtempSync(join(tmpdir(), "cueloop-harness-hosts-"));
const hostEnv = {
  ...process.env,
  CLAUDE_CONFIG_DIR: join(work, "claude-config"),
  CODEX_HOME: join(work, "codex-home"),
};
const globalPrefix = Bun.spawnSync(["npm", "prefix", "-g"]).stdout.toString().trim();
function globalHostCommand(name: "claude" | "codex" | "pi"): string {
  const path = join(globalPrefix, "bin", name);

  return existsSync(path) ? path : name;
}
const hostExecutables = {
  claude: globalHostCommand("claude"),
  codex: globalHostCommand("codex"),
  pi: globalHostCommand("pi"),
};

try {
  const marketplace = join(work, "claude-marketplace");

  mkdirSync(hostEnv.CLAUDE_CONFIG_DIR);
  mkdirSync(hostEnv.CODEX_HOME);
  mkdirSync(join(marketplace, ".claude-plugin"), { recursive: true });
  const cliPackage = v.parse(
    v.object({ version: v.string() }),
    await Bun.file(join(REPO_ROOT, "packages/cli/package.json")).json(),
  );

  writeFileSync(
    join(marketplace, ".claude-plugin/marketplace.json"),
    JSON.stringify({
      name: "cueloop-host-smoke",
      description: "Local cueloop harness installation smoke",
      owner: { name: "cueloop" },
      plugins: [
        {
          name: "cueloop",
          source: {
            source: "command",
            command: `printf '%s\\n' '${REPO_ROOT.replaceAll("'", "'\\''")}'`,
            mode: "link",
          },
          version: cliPackage.version,
        },
      ],
    }),
  );
  runHostCommand(["claude", "plugin", "validate", REPO_ROOT, "--strict"]);
  runHostCommand(["claude", "plugin", "validate", marketplace, "--strict"]);
  await inspectPiExtension(work);

  if (!validateOnly) {
    if (process.env.GITHUB_ACTIONS !== "true" && !localSmoke) {
      throw new Error("Harness host installation smoke needs an ephemeral runner or --local-smoke");
    }
    if (!localSmoke) {
      for (const [command, version] of [
        ["claude", hostVersions.claude],
        ["codex", hostVersions.codex],
        ["pi", hostVersions.pi],
      ] as const) {
        const actual = runHostCommand([command, "--version"]);

        if (!actual.includes(version)) {
          throw new Error(
            `${command} host ${actual.trim()} does not match pinned version ${version}`,
          );
        }
      }
    }

    runHostCommand(["claude", "plugin", "marketplace", "add", marketplace], work);
    runHostCommand(["claude", "plugin", "install", "cueloop@cueloop-host-smoke", "--yes"], work);
    const claudeList = v.parse(
      v.array(v.object({ id: v.string(), version: v.string(), installPath: v.string() })),
      JSON.parse(runHostCommand(["claude", "plugin", "list", "--json"], work)),
    );
    const claudePlugin = claudeList.find((plugin) => plugin.id === "cueloop@cueloop-host-smoke");

    if (!claudePlugin?.version.startsWith(cliPackage.version)) {
      throw new Error("Claude Code did not install the matching cueloop Mod plugin");
    }
    checkInstalledSkills(claudePlugin.installPath, "Claude Code");
    runHostCommand(["claude", "plugin", "validate", claudePlugin.installPath, "--strict"], work);
    runHostCommand(["claude", "plugin", "details", "cueloop@cueloop-host-smoke"], work);

    runHostCommand(["codex", "plugin", "marketplace", "add", REPO_ROOT]);
    runHostCommand(["codex", "plugin", "add", "cueloop@cueloop"]);
    const codexList = v.parse(
      v.object({ installed: v.array(v.object({ pluginId: v.string(), version: v.string() })) }),
      JSON.parse(runHostCommand(["codex", "plugin", "list", "--json"])),
    );

    if (
      !codexList.installed.some(
        (plugin) => plugin.pluginId === "cueloop@cueloop" && plugin.version === cliPackage.version,
      )
    ) {
      throw new Error("Codex did not install the matching cueloop plugin");
    }
    checkInstalledSkills(
      join(hostEnv.CODEX_HOME, "plugins/cache/cueloop/cueloop", cliPackage.version),
      "Codex",
    );
    if (!runHostCommand(["codex", "mcp", "list"]).includes("cueloop")) {
      throw new Error("Codex did not load the cueloop MCP server");
    }
    const codexMcp = v.parse(
      v.object({ transport: v.object({ command: v.string(), args: v.array(v.string()) }) }),
      JSON.parse(runHostCommand(["codex", "mcp", "get", "cueloop", "--json"])),
    );

    if (
      codexMcp.transport.command !== "cueloop" ||
      JSON.stringify(codexMcp.transport.args) !== '["mcp"]'
    ) {
      throw new Error("Codex MCP entry does not launch cueloop mcp");
    }
  }

  console.log("harness host smoke passed");
} finally {
  rmSync(work, { recursive: true, force: true });
}
