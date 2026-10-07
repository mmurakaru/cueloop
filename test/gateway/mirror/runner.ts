import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import * as v from "valibot";
import { createModels, fauxAssistantMessage, fauxProvider } from "@earendil-works/pi-ai";
import { DaemonServer } from "../../../packages/daemon/src/server";
import { DaemonClient } from "../../../packages/daemon/src/client";
import { packSessionBlob } from "../../../packages/daemon/src/share-blob";
import { ThreadRecordSchema } from "../../../packages/daemon/src/validate";
import { OwnerAgentRelay } from "../../../packages/adapters/src/owner-agent-relay";
import { createPiHarness } from "../../../packages/adapters/src/pi/durable-harness";
import { generateEd25519Key } from "../../../packages/gateway/src/host-key";
import { R2ShareStore, WatchedShareStore } from "../../../packages/gateway/src/store";
import { SharedAgentRelay } from "../../../packages/gateway/src/shared-agent";
import {
  cancelMirrorRun,
  finishMirrorRun,
  runMirrorCommand,
  waitForMirrorCondition,
} from "./mirror-process";
import { connectMirrorSsh, execMirrorSsh, MirrorSshView } from "./mirror-ssh";

const project = `cueloop-gateway-mirror-${randomUUID().slice(0, 8)}`;
const home = mkdtempSync(join(tmpdir(), "cueloop-gateway-owner-"));
const reportDirectory = mkdtempSync(join(tmpdir(), "cueloop-gateway-report-"));
const compose = ["docker", "compose", "-p", project, "-f", resolve(import.meta.dir, "compose.yml")];
const ownerKey = generateEd25519Key();
const ownerKeyPath = join(home, "owner-key");
const models = createModels();
const provider = fauxProvider({ tokensPerSecond: 80, tokenSize: { min: 1, max: 1 } });
const views: MirrorSshView[] = [];
const passed: string[] = [];
let server: DaemonServer | undefined;
let relay: OwnerAgentRelay | undefined;
let client: DaemonClient | undefined;
let port = 0;
let shareId = "";

writeFileSync(ownerKeyPath, ownerKey, { mode: 0o600 });
models.setProvider(provider.provider);
provider.setResponses([
  fauxAssistantMessage("Mirror first answer: café 日本語"),
  fauxAssistantMessage("Mirror second answer"),
  (context) => {
    assert.match(JSON.stringify(context.messages), /Mirror first question/);
    assert.match(JSON.stringify(context.messages), /Mirror second question/);

    return fauxAssistantMessage("Mirror recovered answer");
  },
]);

function startMirrorOwner(): void {
  server = new DaemonServer({
    home,
    idleExitMs: 0,
    threadAgent: { enabled: true, adapter: createPiHarness({ home, models }) },
    onEvent: (event) => relay?.notify(event),
  });
  server.start();
  server.resumeAgents();
  relay = new OwnerAgentRelay({
    home,
    enabled: () => true,
    onError: (error) =>
      writeFileSync(join(reportDirectory, "owner-relay.log"), error.message + "\n", { flag: "a" }),
    transport: {
      open: () =>
        Bun.spawn(
          [
            "ssh",
            "-p",
            String(port),
            "-i",
            ownerKeyPath,
            "-o",
            "IdentitiesOnly=yes",
            "-o",
            "IdentityAgent=none",
            "-o",
            `UserKnownHostsFile=${join(home, "known_hosts")}`,
            "-o",
            "StrictHostKeyChecking=accept-new",
            "-o",
            "ConnectTimeout=5",
            "-o",
            "ServerAliveInterval=1",
            "-o",
            "ServerAliveCountMax=2",
            "share@127.0.0.1",
            "cueloop-agent",
          ],
          { stdin: "pipe", stdout: "pipe", stderr: "pipe" },
        ),
    },
  });
}

function recordMirrorPass(label: string): void {
  passed.push(label);
  console.log(`PASS ${label}`);
}

async function openMirrorViewer(key: string, title = "Gateway mirror"): Promise<MirrorSshView> {
  const view = new MirrorSshView();

  views.push(view);
  await view.open({ port, privateKey: key, username: shareId }, title);

  return view;
}

async function typeMirrorPrompt(view: MirrorSshView, text: string): Promise<void> {
  view.click(65, view.rows - 5);
  await view.waitForScreen(() => view.terminal.readCursor().visible, "continuation cursor");
  view.write(text);
  await view.waitForText(text);
  view.press(["ctrl", "enter"]);
}

async function runGatewayMirror(): Promise<void> {
  await runMirrorCommand(["docker", "info", "--format", "{{.ServerVersion}}"]);
  await runMirrorCommand([...compose, "up", "-d", "--build"], 600_000);
  const address = (await runMirrorCommand([...compose, "port", "gateway", "22"])).toString().trim();
  const s3Address = (await runMirrorCommand([...compose, "port", "s3", "8333"])).toString().trim();

  assert.match(address, /^127\.0\.0\.1:\d+$/);
  assert.match(s3Address, /^127\.0\.0\.1:\d+$/);
  port = Number(address.split(":")[1]);
  const identity = { port, privateKey: ownerKey, username: "share" };

  await waitForMirrorCondition("gateway SSH readiness", async () => {
    const connection = await connectMirrorSsh(identity);

    connection.end();

    return true;
  });
  const profile = (
    await runMirrorCommand([
      ...compose,
      "exec",
      "-T",
      "gateway",
      "sh",
      "-c",
      "uname -m; id -u; bun --version; cat /etc/os-release; stat -c '%a' /state/master.key /state/host_key; cat /sys/fs/cgroup/cpu.max /sys/fs/cgroup/memory.max",
    ])
  ).toString();

  assert.match(profile, /x86_64/);
  assert.match(profile, /\n1000\n/);
  assert.match(profile, /1\.3\.14/);
  assert.match(profile, /VERSION_ID="24\.04"/);
  assert.match(profile, /600\n600/);
  assert.match(profile, /100000 100000\n1073741824/);
  recordMirrorPass("Ubuntu amd64, non-root Bun, port 22 and private persistent keys");
  const key = await runMirrorCommand([
    ...compose,
    "exec",
    "-T",
    "gateway",
    "cat",
    "/state/master.key",
  ]);
  const hostKey = await runMirrorCommand([
    ...compose,
    "exec",
    "-T",
    "gateway",
    "cat",
    "/state/host_key",
  ]);
  const store = new R2ShareStore({
    endpoint: `http://${s3Address}`,
    bucket: "cueloop-mirror",
    accessKeyId: "mirror-local-access",
    secretAccessKey: "mirror-local-secret-only",
  });
  const observer = new SharedAgentRelay(new WatchedShareStore(store), key);

  await waitForMirrorCondition("S3 bucket readiness", async () => {
    await store.put("mirror-readiness", Buffer.from("ready"));
    const result = await store.get("mirror-readiness");

    return Buffer.from(result ?? []).toString() === "ready";
  });
  startMirrorOwner();
  const thread = server!.core.sessionCreate({
    workspace: { repoRoot: home, branch: "main" },
    artifact: {
      type: "plan",
      content: "Review this gateway proposal.\n",
      meta: { title: "Gateway mirror" },
    },
  });

  server!.core.sessionSetShares(thread.id, [
    { id: "upload", requireAuth: false, allowlist: [], agentEnabled: true },
  ]);
  const output = (
    await execMirrorSsh(
      identity,
      "cueloop-share",
      packSessionBlob(server!.core.sessionGet(thread.id)),
    )
  ).toString();

  shareId = output.match(/ssh (p_[A-Za-z0-9]{8})@/)?.[1] ?? "";
  assert.ok(shareId, output);
  const published = v.parse(
    ThreadRecordSchema,
    JSON.parse((await execMirrorSsh(identity, "cueloop-pull", shareId)).toString()),
  );

  server!.core.sessionSetShares(thread.id, published.shares!);
  relay!.update([server!.core.sessionGet(thread.id)]);
  client = await DaemonClient.connect({ home });
  const first = await openMirrorViewer(generateEd25519Key());
  const second = await openMirrorViewer(generateEd25519Key());

  await first.waitForScreen(() => !first.text().includes("Owner offline"), "owner relay online");
  await first.selectText("gateway proposal");
  first.write("Inline mirror note");
  await first.waitForText("Inline mirror note");
  first.press(["alt", "enter"]);
  await second.waitForText("Inline mirror note");
  assert.equal(provider.state.callCount, 0);
  assert.equal((await client.agentGet(thread.id)).submissions?.length ?? 0, 0);
  recordMirrorPass("Option+Enter saves inline notes and broadcasts without invoking Pi");
  await typeMirrorPrompt(first, "Mirror first question");
  await first.waitForText("Mirror first answer");
  await first.waitForText("café 日本語");
  await second.waitForText("Mirror first answer");
  await second.waitForText("café 日本語");
  assert.equal(provider.state.callCount, 1);
  recordMirrorPass(
    "collaborator Ctrl+Enter executes in owner Pi and broadcasts to another SSH viewer",
  );
  await typeMirrorPrompt(second, "Mirror second question");
  await first.waitForText("Mirror second answer");
  await second.waitForText("Mirror second answer");
  assert.equal(provider.state.callCount, 2);
  assert.equal(
    (await client.agentGet(thread.id)).messages.filter((entry) => entry.role === "user").length,
    2,
  );
  recordMirrorPass("another collaborator continues the same durable conversation");
  const encrypted = await store.get(shareId + ".agent");

  assert.ok(encrypted);
  assert.ok(!Buffer.from(encrypted).includes(Buffer.from("Mirror first question")));
  assert.ok(!Buffer.from(encrypted).includes(Buffer.from("Mirror first answer")));
  recordMirrorPass("agent history is encrypted in real S3 storage");
  await assert.rejects(
    execMirrorSsh(
      { ...identity, privateKey: generateEd25519Key() },
      "cueloop-agent",
      JSON.stringify({ type: "hello", shareId }) + "\n",
      false,
    ),
    /agent relay rejected/i,
  );
  recordMirrorPass("another SSH identity cannot attach the owner execution channel");
  relay!.stop();
  relay = undefined;
  client.close();
  client = undefined;
  await server!.shutdown();
  server = undefined;
  await first.waitForText("Owner offline");
  await typeMirrorPrompt(first, "Mirror offline question");
  await waitForMirrorCondition("offline input persisted in S3", async () =>
    (await observer.get(shareId)).messages.some(
      (entry) => entry.text === "Mirror offline question",
    ),
  );
  assert.equal(provider.state.callCount, 2);
  recordMirrorPass("owner offline is visible and input queues without execution");
  first.close();
  second.close();
  await runMirrorCommand([...compose, "stop", "gateway", "s3"]);
  await runMirrorCommand([...compose, "up", "-d", "--force-recreate"]);
  const newAddress = (await runMirrorCommand([...compose, "port", "gateway", "22"]))
    .toString()
    .trim();

  port = Number(newAddress.split(":")[1]);
  const newS3Address = (await runMirrorCommand([...compose, "port", "s3", "8333"]))
    .toString()
    .trim();
  const recoveredIdentity = { ...identity, port };

  await waitForMirrorCondition("recreated gateway SSH readiness", async () => {
    const connection = await connectMirrorSsh(recoveredIdentity);

    connection.end();

    return true;
  });
  assert.deepEqual(
    await runMirrorCommand([...compose, "exec", "-T", "gateway", "cat", "/state/master.key"]),
    key,
  );
  assert.deepEqual(
    await runMirrorCommand([...compose, "exec", "-T", "gateway", "cat", "/state/host_key"]),
    hostKey,
  );
  const recoveredStore = new R2ShareStore({
    endpoint: `http://${newS3Address}`,
    bucket: "cueloop-mirror",
    accessKeyId: "mirror-local-access",
    secretAccessKey: "mirror-local-secret-only",
  });
  const recoveredObserver = new SharedAgentRelay(new WatchedShareStore(recoveredStore), key);

  await waitForMirrorCondition("persistent pending input after container replacement", async () =>
    (await recoveredObserver.get(shareId)).messages.some(
      (entry) => entry.text === "Mirror offline question",
    ),
  );
  const recovered = await openMirrorViewer(generateEd25519Key());

  await recovered.waitForText("Owner offline");
  recordMirrorPass(
    "gateway and S3 container replacement preserve host identity, transcript and offline queue",
  );
  startMirrorOwner();
  relay!.update(server!.core.sessionList({ status: "pending" }));
  client = await DaemonClient.connect({ home });
  await recovered.waitForText("Mirror recovered answer");
  assert.equal(provider.state.callCount, 3);
  const durable = await client.agentGet(thread.id);

  assert.equal(
    durable.messages.filter((entry) => entry.text === "Mirror offline question").length,
    1,
  );
  assert.equal(durable.promptOperations?.length, 3);
  recordMirrorPass("owner restart reopens Pi context and admits the offline request exactly once");
  relay!.stop();
  relay = undefined;
  // Reattach without new input and wait for a published online state.
  client.close();
  client = undefined;
  await server!.shutdown();
  server = undefined;
  await recovered.waitForText("Owner offline");
  startMirrorOwner();
  relay!.update(server!.core.sessionList({ status: "pending" }));
  await recovered.waitForScreen(
    () => !recovered.text().includes("Owner offline"),
    "second owner reconnect",
  );
  assert.equal(provider.state.callCount, 3);
  recordMirrorPass("reconnecting an acknowledged conversation does not repeat model execution");
  const disabledUpload = {
    ...thread,
    shares: [{ id: "upload", requireAuth: false, allowlist: [], agentEnabled: false }],
  };
  const disabledLine = (
    await execMirrorSsh(recoveredIdentity, "cueloop-share", packSessionBlob(disabledUpload))
  ).toString();

  shareId = disabledLine.match(/ssh (p_[A-Za-z0-9]{8})@/)?.[1] ?? "";
  assert.ok(shareId);
  const disabled = await openMirrorViewer(generateEd25519Key());

  assert.ok(!disabled.text().includes("Owner offline"));
  await disabled.selectText("Review this");
  disabled.write("Disabled sharing note");
  await disabled.waitForText("Disabled sharing note");
  disabled.press(["alt", "enter"]);
  await waitForMirrorCondition("ordinary comment saved on disabled share", async () => {
    const saved = v.parse(
      ThreadRecordSchema,
      JSON.parse((await execMirrorSsh(recoveredIdentity, "cueloop-pull", shareId)).toString()),
    );

    return saved.annotations.some((annotation) => annotation.body === "Disabled sharing note");
  });
  await assert.rejects(recoveredObserver.get(shareId), /disabled/);
  assert.equal(provider.state.callCount, 3);
  recordMirrorPass("disabled shared agents retain ordinary comments and reject agent access");
}

let failure: unknown;
let cleaningUp = false;
const cancel = () => {
  if (!cleaningUp) cancelMirrorRun();
};

process.on("SIGINT", cancel);
process.on("SIGTERM", cancel);

try {
  await runGatewayMirror();
} catch (error) {
  failure = error;
  console.error(error);
} finally {
  cleaningUp = true;
  finishMirrorRun();
  for (const view of views) view.close();
  relay?.stop();
  client?.close();
  try {
    await server?.shutdown();
  } catch (error) {
    failure ??= error;
    console.error("Could not close mirror owner", error);
  }
  try {
    writeFileSync(
      join(reportDirectory, "gateway.log"),
      await runMirrorCommand([...compose, "logs", "--no-color"], 30_000),
    );
  } catch (error) {
    console.error("Could not capture mirror logs", error);
  }
  try {
    await runMirrorCommand([...compose, "down", "--volumes", "--remove-orphans"], 60_000);
  } catch (error) {
    failure ??= error;
    console.error("Could not remove mirror containers", error);
  }
  rmSync(home, { recursive: true, force: true });
  writeFileSync(
    join(reportDirectory, "report.json"),
    JSON.stringify(
      {
        project,
        passed,
        success: !failure,
        error: failure instanceof Error ? failure.message : failure,
      },
      null,
      2,
    ),
  );
  console.log(`Gateway mirror report: ${reportDirectory}`);
  process.removeListener("SIGINT", cancel);
  process.removeListener("SIGTERM", cancel);
}

if (failure) process.exitCode = 1;
