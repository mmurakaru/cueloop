import { expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

test.each(["SIGINT", "SIGTERM"])(
  "standalone watch finishes cleanup and exits with blocked output on %s",
  async (signal) => {
    const directory = mkdtempSync(join(tmpdir(), "cueloop-sync-watch-"));
    const application = join(directory, "application.mjs");
    const ready = join(directory, "ready");
    const cleanup = join(directory, "cleanup");
    const watcherUrl = pathToFileURL(resolve("examples/sync-workspace/watch-records.ts")).href;

    writeFileSync(
      application,
      `
import { appendFileSync, writeFileSync } from 'node:fs';
import { watchSharedRecords } from ${JSON.stringify(watcherUrl)};
const record = event => appendFileSync(${JSON.stringify(cleanup)}, event + '\\n');
const client = {
  materialize: () => ({
    addListener: listener => { listener([{content: 'x'.repeat(6 * 1024 * 1024)}], 'complete'); return () => {}; },
    destroy: () => record('view'),
  }),
  close: () => record('client'),
};
export const syncApplication = {
  fetch: () => new Response('ok'),
  async connect() {
    setImmediate(() => writeFileSync(${JSON.stringify(ready)}, process.stdout.writableNeedDrain ? 'blocked' : 'flowing'));
    try { return await watchSharedRecords(client, {}); } finally { client.close(); }
  },
  close: () => record('application'),
};
`,
    );

    try {
      const child = Bun.spawn(
        [
          "node",
          "test/helpers/sync-watch-consumer.mjs",
          resolve("packages/sync/bin/cueloop-sync.js"),
          application,
          ready,
          cleanup,
          signal,
        ],
        { stdout: "pipe", stderr: "pipe", signal: AbortSignal.timeout(25000) },
      );
      const [output, error, status] = await Promise.all([
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
        child.exited,
      ]);

      expect(status, error).toBe(0);
      expect(output).toContain("Interrupted sync watch exited after cleanup");
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  },
  30000,
);

test("standalone finite commands drain their complete output before exit", async () => {
  const directory = mkdtempSync(join(tmpdir(), "cueloop-sync-output-"));
  const application = join(directory, "application.mjs");

  writeFileSync(
    application,
    "export const syncApplication={fetch:()=>new Response('ok'),async connect(){process.stdout.write('x'.repeat(6*1024*1024));return {status:'completed'};}};",
  );

  try {
    const child = Bun.spawn(
      ["node", "packages/sync/bin/cueloop-sync.js", "connect", "--application", application],
      {
        stdout: "pipe",
        stderr: "pipe",
        signal: AbortSignal.timeout(10000),
      },
    );
    const output = await new Response(child.stdout).arrayBuffer();

    expect(await child.exited).toBe(0);
    expect(output.byteLength).toBe(6 * 1024 * 1024);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}, 15000);
