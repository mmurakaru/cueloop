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
  for (const dependency of ["valibot", "uuid", "canonicalize"]) {
    symlinkSync(resolve("node_modules", dependency), join(modules, dependency), "dir");
  }

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
    const source = `
      import {createSyncClient} from '@cueloop/sync';
      import {createSchema, table, string} from '@cueloop/sync/schema';
      import {defineSyncOperation, parseSyncOperation} from '@cueloop/sync/operations';
      import {readFileSync} from 'node:fs';
      import * as v from 'valibot';
      const schema=createSchema({tables:[table('record').columns({id:string()}).primaryKey('id')]});
      const client=createSyncClient({schema,cacheURL:null,kvStore:'mem'});
      await client.close();
      const definition=defineSyncOperation({name:'comment.add',version:1,arguments:v.object({body:v.string()})});
      const operation=definition.create({workspaceIdentifier:'019a6650-0000-7000-8000-000000000001',arguments:{body:'Packed request'}});
      if (parseSyncOperation(JSON.parse(JSON.stringify(operation))).arguments.body !== 'Packed request') throw new Error('Packed operation lost its arguments');
      readFileSync(new URL(import.meta.resolve('@cueloop/sync/migrations/001-operation-receipt.sql')));
      console.log('Packed SDK closed');
    `;
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
