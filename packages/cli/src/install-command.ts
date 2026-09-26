import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import * as v from "valibot";
import {
  discoverInstalledExtensionPackages,
  extensionInstallRoot,
} from "@cueloop/extension-api/installed-packages";

const NPM_PACKAGE_SOURCE = /^npm:((?:@[a-z0-9_.-]+\/)?[a-z0-9_.-]+)(?:@([^\s/]+))?$/i;

interface PackageCommandResult {
  exitCode: number;
  stderr: string;
}

interface InstallOptions {
  installRoot?: string;
  runPackageCommand?: (args: string[]) => Promise<PackageCommandResult>;
}

async function runPackageCommand(args: string[]): Promise<PackageCommandResult> {
  // A compiled executable can invoke its bundled Bun CLI without `bun` on PATH.
  const child = Bun.spawn([process.execPath, ...args], {
    env: { ...process.env, BUN_BE_BUN: "1" },
    stdout: "ignore",
    stderr: "pipe",
  });
  const [exitCode, stderr] = await Promise.all([child.exited, new Response(child.stderr).text()]);

  return { exitCode, stderr };
}

function previousPackageSpec(installRoot: string, name: string): string | null {
  const path = join(installRoot, "node_modules", name, "package.json");

  if (!existsSync(path)) return null;
  try {
    const parsed = v.safeParse(
      v.object({ version: v.pipe(v.string(), v.minLength(1)) }),
      JSON.parse(readFileSync(path, "utf8")),
    );

    return parsed.success ? `${name}@${parsed.output.version}` : null;
  } catch {
    return null;
  }
}

/** Install a user-level npm extension after checking its declared entry points. */
export async function installExtensionCommand(
  argv: string[],
  options: InstallOptions = {},
): Promise<number> {
  const source = argv[0];
  const match = source?.match(NPM_PACKAGE_SOURCE);

  if (argv.length !== 1 || !match) {
    console.error("cueloop install: expected npm:<package>[@version]");

    return 2;
  }
  const name = match[1]!;
  const spec = source!.slice("npm:".length);
  const installRoot = options.installRoot ?? extensionInstallRoot();
  const runCommand = options.runPackageCommand ?? runPackageCommand;
  const previousSpec = previousPackageSpec(installRoot, name);

  mkdirSync(installRoot, { recursive: true });
  const rootManifest = join(installRoot, "package.json");

  if (!existsSync(rootManifest)) {
    writeFileSync(
      rootManifest,
      JSON.stringify({ name: "cueloop-extensions", private: true }, null, 2),
    );
  }
  const { exitCode, stderr } = await runCommand([
    "add",
    "--ignore-scripts",
    "--cwd",
    installRoot,
    spec,
  ]);

  if (exitCode !== 0) {
    console.error(`cueloop install: ${stderr.trim() || "bun add failed"}`);

    return 1;
  }
  const discovered = discoverInstalledExtensionPackages(installRoot);
  const installed = discovered.packages.find((entry) => entry.name === name);

  if (!installed) {
    const error = discovered.errors.find((message) => message.includes(` ${name}:`));
    console.error(`cueloop install: ${error ?? `extension ${name} has no valid cueloop manifest`}`);
    const restored = await runCommand(
      previousSpec
        ? ["add", "--ignore-scripts", "--cwd", installRoot, previousSpec]
        : ["remove", "--ignore-scripts", "--cwd", installRoot, name],
    );

    if (restored.exitCode !== 0)
      console.error(
        `cueloop install: could not restore ${previousSpec ?? name}: ${restored.stderr.trim()}`,
      );

    return 1;
  }
  console.log(
    `Installed ${name}. Restart cueloop and run 'cueloop restart' to load daemon capabilities.`,
  );

  return 0;
}
