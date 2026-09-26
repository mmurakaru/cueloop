import { existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import * as v from "valibot";

const PackageJsonSchema = v.object({
  dependencies: v.optional(v.record(v.string(), v.string())),
  cueloop: v.optional(
    v.object({
      client: v.optional(v.string()),
      daemon: v.optional(v.string()),
    }),
  ),
});

/** The user-owned directory where `cueloop install` keeps npm packages. */
export function extensionInstallRoot(env = process.env): string {
  return (
    env.CUELOOP_EXTENSION_HOME ??
    join(env.XDG_DATA_HOME ?? join(homedir(), ".local", "share"), "cueloop", "extensions")
  );
}

/** One installed package's separate client and daemon extension entry points. */
export interface InstalledExtensionPackage {
  name: string;
  root: string;
  clientEntry?: string;
  daemonEntry?: string;
}

/** Discovery reports bad packages without preventing valid installed extensions from loading. */
export interface ExtensionPackageDiscovery {
  packages: InstalledExtensionPackage[];
  errors: string[];
}

function readPackageJson(path: string): v.InferOutput<typeof PackageJsonSchema> {
  const parsed = v.safeParse(PackageJsonSchema, JSON.parse(readFileSync(path, "utf8")));

  if (!parsed.success) throw new Error("invalid package.json");

  return parsed.output;
}

function packageEntry(root: string, entry: string | undefined): string | undefined {
  if (entry === undefined) return undefined;
  if (!entry.startsWith("./")) throw new Error("entry must start with ./");
  const absolute = resolve(root, entry);
  const lexicalWithin = relative(root, absolute);

  if (isAbsolute(lexicalWithin) || lexicalWithin === ".." || lexicalWithin.startsWith(`..${sep}`))
    throw new Error("entry escapes package root");
  if (!existsSync(absolute)) throw new Error(`entry missing: ${entry}`);
  if (!statSync(absolute).isFile()) throw new Error(`entry is not a file: ${entry}`);
  const within = relative(realpathSync(root), realpathSync(absolute));

  if (isAbsolute(within) || within === ".." || within.startsWith(`..${sep}`))
    throw new Error("entry escapes package root");

  return realpathSync(absolute);
}

/** Discover only declared `cueloop` entries from packages in the managed install root. */
export function discoverInstalledExtensionPackages(
  installRoot = extensionInstallRoot(),
): ExtensionPackageDiscovery {
  const packages: InstalledExtensionPackage[] = [];
  const errors: string[] = [];
  const rootManifest = join(installRoot, "package.json");

  if (!existsSync(rootManifest)) return { packages, errors };
  let dependencies: Record<string, string>;

  try {
    dependencies = readPackageJson(rootManifest).dependencies ?? {};
  } catch (error) {
    return { packages, errors: [`Extension package discovery: ${String(error)}`] };
  }

  for (const name of Object.keys(dependencies).toSorted()) {
    const root = join(installRoot, "node_modules", name);

    try {
      const manifest = readPackageJson(join(root, "package.json")).cueloop;

      if (!manifest) throw new Error("package has no cueloop manifest");
      const clientEntry = packageEntry(root, manifest.client);
      const daemonEntry = packageEntry(root, manifest.daemon);

      if (!clientEntry && !daemonEntry) throw new Error("manifest declares no entry point");
      packages.push({ name, root, clientEntry, daemonEntry });
    } catch (error) {
      errors.push(`Extension package ${name}: ${String(error)}`);
    }
  }

  return { packages, errors };
}
