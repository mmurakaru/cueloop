import { afterEach, expect, test } from "bun:test";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveGithubIdentity } from "./github-identity";

const originalBinary = process.env.CUELOOP_GH;
const tempDirectories: string[] = [];

afterEach(() => {
  if (originalBinary === undefined) delete process.env.CUELOOP_GH;
  else process.env.CUELOOP_GH = originalBinary;
  for (const directory of tempDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

function stubGithubCli(script: string): string {
  const directory = mkdtempSync(join(tmpdir(), "gh-stub-"));

  tempDirectories.push(directory);
  const path = join(directory, "gh");

  writeFileSync(path, `#!/bin/sh\n${script}\n`);
  chmodSync(path, 0o755);

  return path;
}

test("reads the GitHub login and name from gh", async () => {
  process.env.CUELOOP_GH = stubGithubCli(`printf '{"login":"markus","name":"Markus M"}'`);

  expect(await resolveGithubIdentity()).toEqual({ login: "markus", name: "Markus M" });
});

test("drops a null name to undefined", async () => {
  process.env.CUELOOP_GH = stubGithubCli(`printf '{"login":"markus","name":null}'`);

  expect(await resolveGithubIdentity()).toEqual({ login: "markus" });
});

test("falls back to null when gh exits non-zero (logged out)", async () => {
  process.env.CUELOOP_GH = stubGithubCli(`exit 1`);

  expect(await resolveGithubIdentity()).toBeNull();
});

test("falls back to null when gh is not installed", async () => {
  process.env.CUELOOP_GH = join(tmpdir(), "cueloop-absent-gh-binary");

  expect(await resolveGithubIdentity()).toBeNull();
});

test("falls back to null when gh prints an unexpected shape", async () => {
  process.env.CUELOOP_GH = stubGithubCli(`printf 'not json'`);

  expect(await resolveGithubIdentity()).toBeNull();
});
