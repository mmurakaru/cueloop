/**
 * Guard the release machinery against silent regression. A rebase that resolves
 * a package.json conflict the wrong way can quietly drop the changesets
 * scripts, and the loss only surfaces when a release fails - after the merge.
 * CI runs this on every PR.
 */

const problems: string[] = [];

const root = await Bun.file("package.json").json();
const REQUIRED_SCRIPTS = ["test", "typecheck", "changeset", "version", "ci:publish"];
for (const name of REQUIRED_SCRIPTS) {
  if (!root.scripts?.[name]) problems.push(`package.json is missing the "${name}" script`);
}
if (root.scripts?.test && !root.scripts.test.includes("./test")) {
  problems.push('the "test" script must cover ./test (the integration and e2e tiers), not just ./packages');
}
for (const dep of ["@changesets/cli", "@changesets/changelog-github"]) {
  if (!root.devDependencies?.[dep]) problems.push(`package.json is missing the ${dep} devDependency`);
}

if (!(await Bun.file(".changeset/config.json").exists())) problems.push(".changeset/config.json is missing");
if (!(await Bun.file("scripts/sync-plugin-version.ts").exists())) {
  problems.push("scripts/sync-plugin-version.ts is missing (the version step calls it)");
}

// every publishable workspace package needs publish metadata
const globbed = new Bun.Glob("packages/*/package.json");
const nested = new Bun.Glob("packages/integrations/*/package.json");
for await (const path of [globbed.scan("."), nested.scan(".")][Symbol.iterator]()) void path;
const paths: string[] = [];
for await (const p of globbed.scan(".")) paths.push(p);
for await (const p of nested.scan(".")) paths.push(p);
for (const path of paths) {
  const pkg = await Bun.file(path).json();
  if (pkg.private) continue;
  if (pkg.publishConfig?.access !== "public") problems.push(`${path}: publishConfig.access must be "public"`);
  if (!Array.isArray(pkg.files) || pkg.files.length === 0) problems.push(`${path}: files[] must list what ships`);
  // npm renders these on the package page; without them a reader cannot get
  // back to the source or file an issue
  for (const field of ["description", "homepage", "bugs", "repository"]) {
    if (!pkg[field]) problems.push(`${path}: ${field} is missing (npm shows it on the package page)`);
  }
}

if (problems.length) {
  console.error("release integrity check failed:");
  for (const p of problems) console.error(`  - ${p}`);
  process.exit(1);
}
console.log(`release integrity ok (${paths.length} workspace packages checked)`);
