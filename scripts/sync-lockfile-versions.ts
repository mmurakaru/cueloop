/**
 * Keep bun.lock's workspace metadata in step with the versions Changesets just
 * wrote, so the Release PR carries the lockfile change instead of leaving main
 * with stale internal versions.
 *
 * Runs as part of `bun run version`, after the internal-deps rewrite. It first
 * asks Bun to update the lockfile without installing anything. Some Bun versions
 * (including the one CI pins) leave a workspace's own version and its exact
 * internal pins untouched there, so any internal entry that still disagrees with
 * its package.json is then rewritten in place. Only internal packages are
 * touched; external resolutions stay exactly as Bun locked them.
 */

const lockPath = "bun.lock";

const install = Bun.spawnSync(["bun", "install", "--lockfile-only"], {
  stdout: "inherit",
  stderr: "inherit",
});

if (install.exitCode !== 0) process.exit(install.exitCode ?? 1);

type DepField = "dependencies" | "devDependencies" | "peerDependencies" | "optionalDependencies";
type Manifest = { name: string; version?: string } & Partial<
  Record<DepField, Record<string, string>>
>;

const manifests = new Map<string, Manifest>();

for (const pattern of ["packages/*/package.json", "packages/integrations/*/package.json"])
  for await (const path of new Bun.Glob(pattern).scan("."))
    manifests.set(path.slice(0, -"/package.json".length), await Bun.file(path).json());

const internal = new Set([...manifests.values()].map((manifest) => manifest.name));
const depFields = new Set<string>([
  "dependencies",
  "devDependencies",
  "peerDependencies",
  "optionalDependencies",
]);

function isDepField(name: string): name is DepField {
  return depFields.has(name);
}

const lines = (await Bun.file(lockPath).text()).split("\n");
let workspace: Manifest | undefined;
let field: DepField | undefined;
let inWorkspaces = false;
let rewrites = 0;

for (let index = 0; index < lines.length; index++) {
  const line = lines[index];

  if (line === '  "workspaces": {') {
    inWorkspaces = true;
    continue;
  }

  if (!inWorkspaces) continue;

  if (line === "  },") break;

  const entry = line.match(/^ {4}"([^"]*)": \{$/);

  if (entry) {
    workspace = manifests.get(entry[1]);
    field = undefined;
    continue;
  }

  if (!workspace) continue;

  const section = line.match(/^ {6}"([^"]+)": \{$/);

  if (section) {
    field = isDepField(section[1]) ? section[1] : undefined;
    continue;
  }

  const version = line.match(/^( {6}"version": )"([^"]*)",$/);

  if (version && workspace.version && version[2] !== workspace.version) {
    lines[index] = `${version[1]}"${workspace.version}",`;
    rewrites++;
    continue;
  }

  const dep = field ? line.match(/^( {8}"([^"]+)": )"([^"]*)",$/) : null;

  if (dep && field && internal.has(dep[2])) {
    const wanted = workspace[field]?.[dep[2]];

    if (wanted !== undefined && wanted !== dep[3]) {
      lines[index] = `${dep[1]}"${wanted}",`;
      rewrites++;
    }
  }
}

if (rewrites > 0) await Bun.write(lockPath, lines.join("\n"));

console.log(
  `bun.lock workspace metadata: ${rewrites} internal entr${rewrites === 1 ? "y" : "ies"} synced`,
);
