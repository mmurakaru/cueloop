import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("shutdown cancels an unavailable-cache read before draining queued Thread operations", async () => {
  const home = mkdtempSync(join(tmpdir(), "cueloop-sync-shutdown-"));
  const runtime = new URL("./sync-thread-runtime.ts", import.meta.url).href;
  const core = new URL("./api.ts", import.meta.url).href;
  const source = `
import {DaemonCore} from ${JSON.stringify(core)};
import {SyncThreadRuntime} from ${JSON.stringify(runtime)};
const home = process.argv[1];
const core = new DaemonCore(home);
const thread = core.sessionCreate({workspace:{repoRoot:home,branch:"main"},artifact:{type:"plan",content:"Retain the local draft",meta:{}}});
const requested = Promise.withResolvers();
const cache = Bun.serve({port:0, fetch() {requested.resolve(); return new Response("Unavailable",{status:503});}});
const authority = Bun.serve({port:0, fetch() {return Response.json({authorityIdentifier:"019a691a-c6ae-7000-8000-000000000003",generation:"019a691a-c6ae-7000-8000-000000000004",workspaceIdentifier:"019a691a-c6ae-7000-8000-000000000001",workspaceGeneration:"019a691a-c6ae-7000-8000-000000000005"});}});
process.env.SYNC_TEST_SHUTDOWN_TOKEN = "fixture";
const runtime = new SyncThreadRuntime({home,core,enabled:()=>true});
const connection = {authorityURL:authority.url.origin,cacheURL:cache.url.origin,workspaceIdentifier:"019a691a-c6ae-7000-8000-000000000001",actorIdentifier:"owner",authenticationTokenEnvironment:"SYNC_TEST_SHUTDOWN_TOKEN"};
const first = runtime.importThread(thread.id,connection);
const queued = runtime.importThread(thread.id,connection);
const settled = Promise.allSettled([first,queued]);
await requested.promise;
const expired = setTimeout(() => {console.error("Shutdown did not cancel the pending query");process.exit(1);},2000);
await runtime.close();
clearTimeout(expired);
const results = await settled;
if (results.some((result) => result.status !== "rejected")) process.exit(1);
if (core.sessionGet(thread.id).artifact.content !== "Retain the local draft") process.exit(1);
if (!(await runtime.pendingDrafts(thread.id).then(() => false, () => true))) process.exit(1);
authority.stop(true);
cache.stop(true);
core.dispose();
console.log("closed with local input retained");
process.exit(0);
`;

  try {
    const child = Bun.spawn([process.execPath, "--eval", source, home], {
      stdout: "pipe",
      stderr: "pipe",
      signal: AbortSignal.timeout(10000),
    });
    const [output, error, status] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ]);

    expect(status, error).toBe(0);
    expect(output).toContain("closed with local input retained");
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});
