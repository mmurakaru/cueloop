import { checkHarnessReleaseIntegrity } from "./check-harness-release-integrity";

const problems: string[] = [];

const root = await Bun.file("package.json").json();
const REQUIRED_SCRIPTS = ["test", "typecheck", "changeset", "version", "ci:publish"];

for (const name of REQUIRED_SCRIPTS) {
  if (!root.scripts?.[name]) problems.push(`package.json is missing the "${name}" script`);
}
if (root.scripts?.test && !root.scripts.test.includes("./test")) {
  problems.push(
    'the "test" script must cover ./test (the integration and e2e tiers), not just ./packages',
  );
}
if (root.scripts?.test && !root.scripts.test.includes("./hooks")) {
  problems.push('the "test" script must cover ./hooks (the Claude Mod and plugin manifest)');
}
for (const dep of ["@changesets/cli", "@changesets/changelog-github"]) {
  if (!root.devDependencies?.[dep])
    problems.push(`package.json is missing the ${dep} devDependency`);
}

if (!(await Bun.file(".changeset/config.json").exists()))
  problems.push(".changeset/config.json is missing");
if (!(await Bun.file("scripts/sync-plugin-version.ts").exists())) {
  problems.push("scripts/sync-plugin-version.ts is missing (the version step calls it)");
}
problems.push(...(await checkHarnessReleaseIntegrity()));

const codexManifest = await Bun.file("plugin.json").json();
const codexCompatibilityManifest = await Bun.file(".codex-plugin/plugin.json").json();
const expectedCodexCompatibilityManifest = {
  name: codexManifest.name,
  version: codexManifest.version,
  description: codexManifest.description,
  author: { name: codexManifest.author.name },
  skills: "./skills/",
  interface: codexManifest.extensions["com.openai"].interface,
};

if (
  JSON.stringify(codexCompatibilityManifest) !== JSON.stringify(expectedCodexCompatibilityManifest)
) {
  problems.push("Codex compatibility manifest differs from plugin.json");
}
for (const path of ["mcp.json", codexManifest.extensions["com.openai"].hooks]) {
  if (!(await Bun.file(path).exists())) problems.push(`Codex plugin references missing ${path}`);
}

// every publishable workspace package needs publish metadata
const paths: string[] = [];

for await (const path of new Bun.Glob("packages/*/package.json").scan(".")) paths.push(path);
for await (const path of new Bun.Glob("packages/integrations/*/package.json").scan("."))
  paths.push(path);
for (const path of paths) {
  const pkg = await Bun.file(path).json();

  if (pkg.private) continue;
  if (pkg.publishConfig?.access !== "public")
    problems.push(`${path}: publishConfig.access must be "public"`);
  if (!Array.isArray(pkg.files) || pkg.files.length === 0)
    problems.push(`${path}: files[] must list what ships`);
  // npm renders these on the package page; without them a reader cannot get
  // back to the source or file an issue
  for (const field of ["description", "homepage", "bugs", "repository"]) {
    if (!pkg[field])
      problems.push(`${path}: ${field} is missing (npm shows it on the package page)`);
  }
}

if (problems.length) {
  console.error("release integrity check failed:");
  for (const problem of problems) console.error(`  - ${problem}`);
  process.exit(1);
}
console.log(`release integrity ok (${paths.length} workspace packages checked)`);
