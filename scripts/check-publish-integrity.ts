/**
 * Pre-publish integrity: pack every publishable package exactly as npm would
 * and assert the tarball actually installs. This catches the class of failure
 * that only shows up after publishing - a tarball that carries a
 * package-manager-only dependency protocol, or one that omits its own entry
 * point - when it is too late to fix without burning a version.
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * --dev: the pre-merge lane, where `workspace:*` is the correct thing to have
 * in the repo (the version step rewrites it). Tarball contents are still
 * verified, which is the part worth knowing before a merge.
 */
const devMode = process.argv.includes("--dev");

const problems: string[] = [];
const paths: string[] = [];
for await (const p of new Bun.Glob("packages/*/package.json").scan(".")) paths.push(p);
for await (const p of new Bun.Glob("packages/integrations/*/package.json").scan(".")) paths.push(p);

const work = mkdtempSync(join(tmpdir(), "cueloop-pack-"));
try {
  for (const path of paths) {
    const dir = path.replace(/\/package\.json$/, "");
    const pkg = (await Bun.file(path).json()) as {
      name: string;
      private?: boolean;
      main?: string;
      bin?: Record<string, string> | string;
      exports?: Record<string, unknown> | string;
      dependencies?: Record<string, string>;
    };
    if (pkg.private) continue;

    // 1. no package-manager-only protocols may reach the registry
    for (const [dep, range] of devMode ? [] : Object.entries(pkg.dependencies ?? {})) {
      if (/^(workspace|link|file|portal):/.test(range)) {
        problems.push(`${pkg.name}: dependency ${dep} uses "${range}", which no npm client can resolve`);
      }
    }

    // 2. the tarball must contain whatever the manifest points at
    const packed = Bun.spawnSync(["npm", "pack", "--json", "--pack-destination", work], { cwd: dir });
    if (packed.exitCode !== 0) {
      problems.push(`${pkg.name}: npm pack failed - ${packed.stderr.toString().trim().split("\n").pop()}`);
      continue;
    }
    const meta = JSON.parse(packed.stdout.toString()) as { filename: string; files: { path: string }[] }[];
    const entry = meta[0];
    if (!entry) {
      problems.push(`${pkg.name}: npm pack produced no tarball metadata`);
      continue;
    }
    const shipped = new Set(entry.files.map((f) => f.path));
    const targets: string[] = [];
    if (typeof pkg.exports === "string") targets.push(pkg.exports);
    else if (pkg.exports) {
      for (const value of Object.values(pkg.exports)) {
        if (typeof value === "string") targets.push(value);
      }
    }
    if (typeof pkg.bin === "string") targets.push(pkg.bin);
    else if (pkg.bin) targets.push(...Object.values(pkg.bin));
    if (pkg.main) targets.push(pkg.main);
    for (const target of targets) {
      const rel = target.replace(/^\.\//, "");
      if (!shipped.has(rel)) problems.push(`${pkg.name}: ships no ${rel}, but the manifest points at it`);
    }
  }
} finally {
  rmSync(work, { recursive: true, force: true });
}

if (problems.length) {
  console.error("publish integrity check failed:");
  for (const p of problems) console.error(`  - ${p}`);
  process.exit(1);
}
console.log(
  `publish integrity ok (${paths.length} packages packed and inspected${devMode ? ", dependency protocols deferred to the release lane" : ""})`,
);
