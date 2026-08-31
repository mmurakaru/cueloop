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

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

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

// 1. every package must be visible on the registry at this exact version
for (const name of new Set(names)) {
  const problem = await settle(async () => {
    const response = await fresh(`https://registry.npmjs.org/${name.replace("/", "%2F")}`);

    if (!response.ok)
      return `${name}: not on the registry (HTTP ${response.status}) - the publish did not land`;
    const doc: {
      versions?: Record<string, object>;
      "dist-tags"?: Record<string, string>;
    } = await response.json();

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
