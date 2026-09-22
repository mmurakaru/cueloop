import * as v from "valibot";
import { WORKFLOW_KINDS } from "@cueloop/schema";

const NamedVersionSchema = v.object({ name: v.string(), version: v.string() });
const ClaudeMarketplaceSchema = v.object({
  plugins: v.array(v.object({ name: v.string(), version: v.string() })),
});
const CodexManifestSchema = v.object({
  name: v.string(),
  version: v.string(),
  extensions: v.object({ "com.openai": v.object({ hooks: v.string() }) }),
});
const PiPackageSchema = v.object({
  name: v.string(),
  version: v.string(),
  pi: v.object({ extensions: v.array(v.string()) }),
  peerDependencies: v.record(v.string(), v.string()),
});
const HostPinsSchema = v.object({ claude: v.string(), codex: v.string(), pi: v.string() });

/** Check that every published harness integration targets the same cueloop release. */
export async function checkHarnessReleaseIntegrity(): Promise<string[]> {
  const problems: string[] = [];
  const cliPackage = v.parse(
    NamedVersionSchema,
    await Bun.file("packages/cli/package.json").json(),
  );
  const claudePlugin = v.parse(
    NamedVersionSchema,
    await Bun.file(".claude-plugin/plugin.json").json(),
  );
  const claudeMarketplace = v.parse(
    ClaudeMarketplaceSchema,
    await Bun.file(".claude-plugin/marketplace.json").json(),
  );
  const codexPlugin = v.parse(CodexManifestSchema, await Bun.file("plugin.json").json());
  const codexCompatibility = v.parse(
    NamedVersionSchema,
    await Bun.file(".codex-plugin/plugin.json").json(),
  );
  const piPackage = v.parse(PiPackageSchema, await Bun.file("packages/pi/package.json").json());
  const hostVersions = v.parse(
    HostPinsSchema,
    await Bun.file("test/install/harness-hosts/pins.json").json(),
  );

  for (const [path, manifest, expectedName] of [
    [".claude-plugin/plugin.json", claudePlugin, "cueloop"],
    ["plugin.json", codexPlugin, "cueloop"],
    [".codex-plugin/plugin.json", codexCompatibility, "cueloop"],
    ["packages/pi/package.json", piPackage, "@cueloop/pi"],
  ] as const) {
    if (manifest.name !== expectedName) {
      problems.push(`${path}: unexpected integration name ${manifest.name}`);
    }
    if (manifest.version !== cliPackage.version) {
      problems.push(`${path}: ${manifest.version} differs from cueloop ${cliPackage.version}`);
    }
  }
  for (const plugin of claudeMarketplace.plugins) {
    if (plugin.name === "cueloop" && plugin.version !== cliPackage.version) {
      problems.push(
        `.claude-plugin/marketplace.json: ${plugin.version} differs from cueloop ${cliPackage.version}`,
      );
    }
  }
  if (!claudeMarketplace.plugins.some((plugin) => plugin.name === "cueloop")) {
    problems.push(".claude-plugin/marketplace.json: cueloop plugin is missing");
  }
  if (!piPackage.pi.extensions.includes("./extension.ts")) {
    problems.push("packages/pi/package.json: pi extension is not registered");
  }
  if (piPackage.peerDependencies["@earendil-works/pi-coding-agent"] !== `^${hostVersions.pi}`) {
    problems.push("packages/pi/package.json: supported pi host differs from install-matrix pin");
  }
  const guard = await Bun.file("hooks/capability-guard.sh").text();

  if (!guard.includes(hostVersions.claude)) {
    problems.push(
      "hooks/capability-guard.sh: supported Claude Code host differs from install-matrix pin",
    );
  }
  for (const path of ["hooks/hooks.json", codexPlugin.extensions["com.openai"].hooks, "mcp.json"]) {
    if (!(await Bun.file(path).exists())) problems.push(`${path}: harness entry point is missing`);
  }
  for (const skill of WORKFLOW_KINDS) {
    if (!(await Bun.file(`skills/${skill}/SKILL.md`).exists())) {
      problems.push(`skills/${skill}/SKILL.md: harness workflow skill is missing`);
    }
  }
  for (const glob of ["packages/*/package.json", "packages/integrations/*/package.json"]) {
    for await (const path of new Bun.Glob(glob).scan(".")) {
      const workspacePackage = v.parse(
        v.object({
          name: v.string(),
          version: v.string(),
          private: v.optional(v.boolean()),
        }),
        await Bun.file(path).json(),
      );

      if (!workspacePackage.private && workspacePackage.version !== cliPackage.version) {
        problems.push(
          `${path}: ${workspacePackage.version} differs from cueloop ${cliPackage.version}`,
        );
      }
    }
  }

  return problems;
}
