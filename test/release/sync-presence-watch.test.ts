import { expect, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

test("presence revocation stops a watch with unread output and releases its application", async () => {
  const directory = mkdtempSync(join(tmpdir(), "cueloop-presence-watch-"));
  const application = join(directory, "application.mjs");
  const ready = join(directory, "ready");
  const cleanup = join(directory, "cleanup");
  const workspaceIdentifier = crypto.randomUUID();
  const peers = Array.from({ length: 100 }, (_, index) => ({
    actorIdentifier: `reader-${index}`,
    workspaceIdentifier,
    connectionIdentifier: crypto.randomUUID(),
    sequence: 1,
    typing: false,
    selection: {
      documentIdentifier: workspaceIdentifier,
      anchor: "a".repeat(1024),
      focus: "a".repeat(1024),
    },
    expiresAt: Date.now() + 15000,
  }));
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(request) {
      await request.arrayBuffer();

      if (existsSync(ready)) return new Response("Forbidden", { status: 403 });

      return Response.json({ peers, leaseMilliseconds: 15000 });
    },
  });
  const consumer = pathToFileURL(resolve("examples/sync-workspace/presence-client.ts")).href;

  writeFileSync(
    application,
    `import { appendFileSync, existsSync, renameSync, writeFileSync } from "node:fs";
import { connectSharedPresence } from ${JSON.stringify(consumer)};
export const syncApplication = {
  fetch: () => new Response("ok"),
  async connect() {
    const monitor = setInterval(() => {
      if (process.stdout.writableNeedDrain && !existsSync(${JSON.stringify(ready)})) {
        writeFileSync(${JSON.stringify(ready + ".next")}, "blocked");
        renameSync(${JSON.stringify(ready + ".next")}, ${JSON.stringify(ready)});
      }
    }, 10);
    try {
      return await connectSharedPresence({ authorityURL: ${JSON.stringify(server.url.href)}, workspaceIdentifier: ${JSON.stringify(workspaceIdentifier)}, auth: "test", watch: true });
    } finally {
      clearInterval(monitor);
      appendFileSync(${JSON.stringify(cleanup)}, "presence\\n");
    }
  },
  close: async () => appendFileSync(${JSON.stringify(cleanup)}, "application\\n"),
};`,
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
        "presence-revoked",
        "presence\napplication\n",
      ],
      { stdout: "pipe", stderr: "pipe", signal: AbortSignal.timeout(15000) },
    );
    const [output, error, status] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ]);

    expect(status, error).toBe(0);
    expect(output).toContain("Sync watch exited after cleanup");
  } finally {
    await server.stop(true);
    rmSync(directory, { recursive: true, force: true });
  }
}, 20000);
