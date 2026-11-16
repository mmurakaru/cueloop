const releasePackage: { version: string } = await Bun.file("packages/cli/package.json").json();
const version = releasePackage.version;
const prereleaseTag = version.includes("-") ? (version.split("-")[1] ?? "").split(".")[0] : null;

if (!prereleaseTag) {
  console.log(`${version} is not a prerelease - nothing to retag`);
  process.exit(0);
}

const names: string[] = [];

for (const glob of ["packages/*/package.json", "packages/integrations/*/package.json"]) {
  for await (const path of new Bun.Glob(glob).scan(".")) {
    const pkg: { name: string; private?: boolean } = await Bun.file(path).json();

    if (!pkg.private) names.push(pkg.name);
  }
}

let failures = 0;

for (const name of new Set(names)) {
  const result = Bun.spawnSync(["npm", "dist-tag", "add", `${name}@${version}`, prereleaseTag]);
  const succeeded = result.exitCode === 0;

  if (succeeded) {
    console.log(`retagged ${name}@${version} as ${prereleaseTag}`);
  } else {
    console.error(`FAILED ${name}@${version} as ${prereleaseTag} (npm exit ${result.exitCode})`);
    console.error(result.stderr.toString().trim());
    failures++;
  }
}

process.exit(failures > 0 ? 1 : 0);
