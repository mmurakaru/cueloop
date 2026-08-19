/**
 * Point the prerelease dist-tag at the current release and deprecate versions
 * known to be unusable.
 *
 * Why this exists: changesets in pre mode publishes to `latest` for a package
 * that has never had a normal release, so the prerelease tag it advertises can
 * be left pointing at an older publish. `npm i cueloop@alpha` then serves a
 * version nobody intended - which is exactly what happened with the first
 * alpha. Runs in the release lane after a successful publish.
 */

const version = (await Bun.file("packages/cli/package.json").json()).version as string;
const preTag = version.includes("-") ? (version.split("-")[1] ?? "").split(".")[0] : null;
if (!preTag) {
  console.log(`${version} is not a prerelease - nothing to retag`);
  process.exit(0);
}

const names: string[] = [];
for (const glob of ["packages/*/package.json", "packages/integrations/*/package.json"]) {
  for await (const path of new Bun.Glob(glob).scan(".")) {
    const pkg = (await Bun.file(path).json()) as { name: string; private?: boolean };
    if (!pkg.private) names.push(pkg.name);
  }
}

let failures = 0;
for (const name of new Set(names)) {
  const result = Bun.spawnSync(["npm", "dist-tag", "add", `${name}@${version}`, preTag]);
  const succeeded = result.exitCode === 0;
  console.log(
    `${succeeded ? "retagged" : "FAILED"} ${name}@${version} as ${preTag}${succeeded ? "" : ": " + result.stderr.toString().trim().split("\n").pop()}`,
  );
  if (!succeeded) failures++;
}

/** Versions that shipped broken; nobody should resolve to them. */
const DEPRECATED: [string, string][] = [
  [
    "cueloop@0.1.0-alpha.0",
    "unusable: internal dependencies shipped as an unresolvable workspace protocol - install cueloop@alpha instead",
  ],
];
for (const [spec, message] of DEPRECATED) {
  const result = Bun.spawnSync(["npm", "deprecate", spec, message]);
  // a version that does not exist is not a failure - the list is historical
  if (result.exitCode === 0) console.log(`deprecated ${spec}`);
}

process.exit(failures > 0 ? 1 : 0);
