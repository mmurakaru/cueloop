import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import * as v from "valibot";

export async function createTestPackedSyncConsumer() {
  const directory = await mkdtemp(join(tmpdir(), "cueloop-sync-clean-consumer-"));
  const packageDirectory = join(directory, "tarballs");
  const configuration = join(directory, "npmrc");

  await mkdir(packageDirectory);
  await writeFile(configuration, "registry=https://registry.npmjs.org\n");
  const run = async (
    arguments_: string[],
    options: { cwd?: string; environment?: Record<string, string> } = {},
  ) => {
    const child = Bun.spawn(arguments_, {
      cwd: options.cwd ?? directory,
      env: {
        ...process.env,
        NPM_CONFIG_USERCONFIG: configuration,
        NODE_AUTH_TOKEN: undefined,
        NPM_TOKEN: undefined,
        ...options.environment,
      },
      stdout: "pipe",
      stderr: "pipe",
      signal: AbortSignal.timeout(90000),
    });
    const [output, errors, status] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ]);

    if (status !== 0) throw new Error(`Packed sync consumer failed: ${errors}`);

    return output;
  };
  const close = () => rm(directory, { recursive: true, force: true });

  try {
    const packed = await run(["npm", "pack", "--silent", "--pack-destination", packageDirectory], {
      cwd: resolve("packages/sync"),
    });
    const tarball = packed
      .trim()
      .split("\n")
      .find((line) => line.endsWith(".tgz"));

    if (!tarball) throw new Error("Packed sync consumer requires its package archive");

    await writeFile(
      join(directory, "package.json"),
      JSON.stringify({
        private: true,
        type: "module",
        dependencies: { "@cueloop/sync": `file:${join(packageDirectory, tarball)}` },
        overrides: { tinypool: "2.2.0" },
      }),
    );
    await run([
      "npm",
      "install",
      "--ignore-scripts",
      "--no-audit",
      "--no-fund",
      "--package-lock=false",
    ]);
    const manifest = v.parse(
      v.object({ exports: v.record(v.string(), v.string()) }),
      await Bun.file(join(directory, "node_modules", "@cueloop", "sync", "package.json")).json(),
    );

    return { directory, run, exports: manifest.exports, close };
  } catch (cause) {
    await close();

    throw cause;
  }
}
