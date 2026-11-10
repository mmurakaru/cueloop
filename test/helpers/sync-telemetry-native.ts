import assert from "node:assert/strict";
import { join } from "node:path";
import { createTestSyncTelemetry } from "./sync-telemetry-setup.ts";
import { DaemonServer } from "@cueloop/daemon";
import { DaemonClient } from "@cueloop/daemon/client";
import { SyncWorkspaceAuthoritySchema } from "@cueloop/sync/authority";
import * as v from "valibot";

const endpoint = process.env.CUELOOP_TEST_OTLP_ENDPOINT;
const authority = v.parse(
  SyncWorkspaceAuthoritySchema,
  JSON.parse(process.env.CUELOOP_TEST_AUTHORITY ?? "null"),
);
const authorityURL = process.env.SYNC_AUTHORITY_URL;
const cacheURL = process.env.SYNC_CACHE_URL;
const actorIdentifier = process.env.SYNC_USER_ID;
const directory = process.env.CUELOOP_TEST_SYNC_DIRECTORY;

if (!endpoint || !authorityURL || !cacheURL || !actorIdentifier || !directory)
  throw new Error("Sync telemetry native fixture requires deployment configuration");

const telemetry = createTestSyncTelemetry(endpoint, "sync-test-native");
const home = join(directory, "telemetry-owner");
const server = new DaemonServer({ home, idleExitMs: 0, sync: { enabledForThread: () => true } });

server.start();
const owner = await DaemonClient.connect({ home });

try {
  const thread = await owner.sessionCreate(
    { repoRoot: directory, branch: "main" },
    {
      type: "plan",
      content: "Private native telemetry document content",
      meta: { title: "Private native telemetry title" },
    },
  );

  await owner.sessionSyncImport(thread.id, {
    authorityURL,
    cacheURL,
    workspaceIdentifier: authority.workspaceIdentifier,
    actorIdentifier,
    authenticationTokenEnvironment: "SYNC_AUTH_TOKEN",
  });
  const edited = await owner.sessionSetWorkingCopy(
    thread.id,
    "Private native telemetry edited content",
  );

  assert.equal(edited.workingCopy, "Private native telemetry edited content");
  process.stdout.write(JSON.stringify({ event: "sync.telemetry.native.completed" }) + "\n");
} finally {
  owner.close();
  await server.shutdown();
  await telemetry.shutdown();
}
