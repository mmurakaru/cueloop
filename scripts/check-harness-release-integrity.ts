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
  const cli = v.parse(NamedVersionSchema, await Bun.file("packages/cli/package.json").json());
  const claude = v.parse(NamedVersionSchema, await Bun.file(".claude-plugin/plugin.json").json());
  const claudeMarketplace = v.parse(
    ClaudeMarketplaceSchema,
    await Bun.file(".claude-plugin/marketplace.json").json(),
  );
  const codex = v.parse(CodexManifestSchema, await Bun.file("plugin.json").json());
  const codexCompatibility = v.parse(
    NamedVersionSchema,
    await Bun.file(".codex-plugin/plugin.json").json(),
  );
  const pi = v.parse(PiPackageSchema, await Bun.file("packages/pi/package.json").json());
  const pins = v.parse(
    HostPinsSchema,
    await Bun.file("test/install/harness-hosts/pins.json").json(),
  );

  for (const [path, manifest, expectedName] of [
    [".claude-plugin/plugin.json", claude, "cueloop"],
    ["plugin.json", codex, "cueloop"],
    [".codex-plugin/plugin.json", codexCompatibility, "cueloop"],
    ["packages/pi/package.json", pi, "@cueloop/pi"],
  ] as const) {
    if (manifest.name !== expectedName) {
      problems.push(`${path}: unexpected integration name ${manifest.name}`);
    }
    if (manifest.version !== cli.version) {
      problems.push(`${path}: ${manifest.version} differs from cueloop ${cli.version}`);
    }
  }
  for (const plugin of claudeMarketplace.plugins) {
    if (plugin.name === "cueloop" && plugin.version !== cli.version) {
      problems.push(
        `.claude-plugin/marketplace.json: ${plugin.version} differs from cueloop ${cli.version}`,
      );
    }
  }
  if (!claudeMarketplace.plugins.some((plugin) => plugin.name === "cueloop")) {
    problems.push(".claude-plugin/marketplace.json: cueloop plugin is missing");
  }
  if (!pi.pi.extensions.includes("./extension.ts")) {
    problems.push("packages/pi/package.json: pi extension is not registered");
  }
  if (pi.peerDependencies["@earendil-works/pi-coding-agent"] !== `^${pins.pi}`) {
    problems.push("packages/pi/package.json: supported pi host differs from install-matrix pin");
  }
  const guard = await Bun.file("hooks/capability-guard.sh").text();

  if (!guard.includes(pins.claude)) {
    problems.push(
      "hooks/capability-guard.sh: supported Claude Code host differs from install-matrix pin",
    );
  }
  for (const path of ["hooks/hooks.json", codex.extensions["com.openai"].hooks, "mcp.json"]) {
    if (!(await Bun.file(path).exists())) problems.push(`${path}: harness entry point is missing`);
  }
  for (const skill of WORKFLOW_KINDS) {
    if (!(await Bun.file(`skills/${skill}/SKILL.md`).exists())) {
      problems.push(`skills/${skill}/SKILL.md: harness workflow skill is missing`);
    }
  }
  for (const glob of ["packages/*/package.json", "packages/integrations/*/package.json"]) {
    for await (const path of new Bun.Glob(glob).scan(".")) {
      const pkg = v.parse(
        v.object({
          name: v.string(),
          version: v.string(),
          private: v.optional(v.boolean()),
        }),
        await Bun.file(path).json(),
      );

      if (!pkg.private && pkg.version !== cli.version) {
        problems.push(`${path}: ${pkg.version} differs from cueloop ${cli.version}`);
      }
    }
  }

  return problems;
}
