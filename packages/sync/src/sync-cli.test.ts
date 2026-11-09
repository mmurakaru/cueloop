import { expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runSyncCli } from "./sync-cli.ts";
import { serveSyncApplication } from "./sync-server.ts";

test("connect passes only application arguments to the client", async () => {
  const directory = mkdtempSync(join(tmpdir(), "cueloop-sync-cli-arguments-"));
  const application = join(directory, "application.mjs");
  const marker = join(directory, "arguments.json");

  writeFileSync(
    application,
    `import {writeFileSync} from 'node:fs'; export const syncApplication={fetch:()=>new Response('ok'),connect:arguments_=>writeFileSync(${JSON.stringify(marker)},JSON.stringify(arguments_))};`,
  );

  try {
    await runSyncCli([
      "connect",
      "--application",
      application,
      "--workspace",
      "example",
      "--limit",
      "1",
    ]);
    expect(JSON.parse(readFileSync(marker, "utf8"))).toEqual([
      "--workspace",
      "example",
      "--limit",
      "1",
    ]);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("invalid CLI options cannot initialize an application", async () => {
  const directory = mkdtempSync(join(tmpdir(), "cueloop-sync-cli-"));
  const application = join(directory, "application.mjs");
  const marker = join(directory, "loaded");

  writeFileSync(
    application,
    `import {writeFileSync} from 'node:fs'; writeFileSync(${JSON.stringify(marker)}, 'loaded'); export const syncApplication={fetch:()=>new Response('ok')};`,
  );

  try {
    await expect(
      runSyncCli(["serve", "--application", application, "--port", "invalid"]),
    ).rejects.toThrow("port must be an integer");
    expect(existsSync(marker)).toBe(false);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("failed authority startup closes the initialized application", async () => {
  const directory = mkdtempSync(join(tmpdir(), "cueloop-sync-cli-close-"));
  const application = join(directory, "application.mjs");
  const marker = join(directory, "closed");
  const occupied = await serveSyncApplication(
    { fetch: () => new Response("occupied") },
    { port: 0 },
  );

  writeFileSync(
    application,
    `import {writeFileSync} from 'node:fs'; export const syncApplication={fetch:()=>new Response('ok'),close:()=>writeFileSync(${JSON.stringify(marker)}, 'closed')};`,
  );

  try {
    await expect(
      runSyncCli(["serve", "--application", application, "--port", String(occupied.port)]),
    ).rejects.toThrow();
    expect(existsSync(marker)).toBe(true);
  } finally {
    await occupied.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
