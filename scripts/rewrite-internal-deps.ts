/**
 * Rewrite internal dependency ranges to the concrete lockstep version.
 *
 * `workspace:*` is a package-manager protocol, not a registry range: npm
 * clients cannot resolve it, so a tarball carrying it installs broken. All
 * cueloop packages version in lockstep, so pinning internal deps to the exact
 * current version is both correct and the simplest thing that works - and bun
 * still links the local copy during development because the workspace member
 * satisfies that exact version.
 *
 * Runs as part of `bun run version`, so the Release PR shows the rewrite.
 */

const paths = ["packages/cli/package.json"];
for await (const path of new Bun.Glob("packages/*/package.json").scan(".")) paths.push(path);
for await (const path of new Bun.Glob("packages/integrations/*/package.json").scan(".")) paths.push(path);

const version = (await Bun.file("packages/cli/package.json").json()).version as string;
const internal = new Set<string>();
for (const path of [...new Set(paths)]) {
  internal.add((await Bun.file(path).json()).name as string);
}

let rewrites = 0;
for (const path of [...new Set(paths)]) {
  const pkg = (await Bun.file(path).json()) as Record<string, Record<string, string>> & { name: string };
  let touched = false;
  for (const field of ["dependencies", "devDependencies", "peerDependencies"]) {
    const deps = pkg[field];
    if (!deps) continue;
    for (const [name, range] of Object.entries(deps)) {
      if (internal.has(name) && range.startsWith("workspace:")) {
        deps[name] = version;
        touched = true;
        rewrites++;
      }
    }
  }
  if (touched) await Bun.write(path, JSON.stringify(pkg, null, 2) + "\n");
}
console.log(`internal deps pinned to ${version} (${rewrites} rewritten)`);
