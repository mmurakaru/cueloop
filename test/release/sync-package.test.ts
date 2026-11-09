import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

test("the packed sync SDK and CLI run from node_modules under Node", async () => {
  const directory = mkdtempSync(join(tmpdir(), "cueloop-sync-package-"));
  const modules = join(directory, "node_modules");
  const installed = join(modules, "@cueloop", "sync");

  mkdirSync(installed, { recursive: true });
  symlinkSync(resolve("node_modules/@rocicorp"), join(modules, "@rocicorp"), "dir");
  symlinkSync(resolve("node_modules/valibot"), join(modules, "valibot"), "dir");

  try {
    const pack = Bun.spawn(["npm", "pack", "--silent", "--pack-destination", directory], {
      cwd: "packages/sync",
      stdout: "pipe",
      stderr: "pipe",
    });
    const output = await new Response(pack.stdout).text();

    expect(await pack.exited).toBe(0);
    const tarball = output
      .trim()
      .split("\n")
      .find((line) => line.endsWith(".tgz"));

    if (!tarball) throw new Error("Sync package test did not receive a tarball");

    const extract = Bun.spawn([
      "tar",
      "-xf",
      join(directory, tarball),
      "--strip-components",
      "1",
      "-C",
      installed,
    ]);

    expect(await extract.exited).toBe(0);
    const source = `import {createSyncClient} from '@cueloop/sync'; import {createSchema, table, string} from '@cueloop/sync/schema'; const schema=createSchema({tables:[table('record').columns({id:string()}).primaryKey('id')]}); const client=createSyncClient({schema,cacheURL:null,kvStore:'mem'}); await client.close(); console.log('Packed SDK closed');`;
    const consumer = Bun.spawn(["node", "--input-type=module", "-e", source], {
      cwd: directory,
      stdout: "pipe",
      stderr: "pipe",
      signal: AbortSignal.timeout(5000),
    });
    const result = await new Response(consumer.stdout).text();

    expect(await consumer.exited).toBe(0);
    expect(result).toContain("Packed SDK closed");
    const cli = Bun.spawn(["node", join(installed, "bin", "cueloop-sync.js"), "--help"], {
      stdout: "pipe",
      stderr: "pipe",
      signal: AbortSignal.timeout(5000),
    });
    const help = await new Response(cli.stdout).text();

    expect(await cli.exited).toBe(0);
    expect(help).toContain("General-purpose sync for terminals");
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}, 30000);
