import * as v from "valibot";
import { SyncAuthorityIdentitySchema } from "@cueloop/sync/authority";
import { expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { DaemonCore } from "./api";
import { ThreadStore } from "./store";
import { SyncThreadLocalState } from "./sync-thread-local-state";

const connection = {
  authorityURL: "http://localhost:4849",
  cacheURL: "http://localhost:4848",
  actorIdentifier: "owner",
  authenticationTokenEnvironment: "SYNC_AUTH_TOKEN",
  workspaceIdentifier: "019a691a-c6ae-7000-8000-000000000001",
  recordIdentifier: "019a691a-c6ae-7000-8000-000000000002",
};

test("pending imports fence native writers across restart and retain a recoverable snapshot without services", () => {
  const home = mkdtempSync(join(tmpdir(), "cueloop-thread-fence-"));
  const local = new DaemonCore(home);

  try {
    const thread = local.sessionCreate({
      workspace: { repoRoot: home, branch: "main" },
      artifact: { type: "plan", content: "Saved local plan", meta: {} },
    });
    const state = new SyncThreadLocalState(home);

    state.begin({ thread, connection, upload: "stable-upload" });
    const recovered = new ThreadStore(home);

    recovered.recover();
    expect(() => recovered.upsert({ ...thread, workingCopy: "Competing local write" })).toThrow(
      "authority",
    );
    expect(() => recovered.delete(thread.id)).toThrow("authority");
    const projection = recovered.get(thread.id);

    if (!projection) throw new Error("Pending Thread requires its recovery snapshot");

    projection.workingCopy = "Mutated cache reference";
    expect(recovered.get(thread.id)?.workingCopy).toBeUndefined();
    expect(state.read(thread.id)).toMatchObject({ phase: "importing", connection });
    expect(state.readUpload(thread.id)).toBe("stable-upload");
    expect(recovered.list().map((record) => record.id)).toContain(thread.id);
    const manifest = state.manifestPath(thread.id);

    writeFileSync(manifest, "broken journal");
    const corrupted = new ThreadStore(home);

    corrupted.recover();
    expect(() => corrupted.upsert(thread)).toThrow("authority");
    expect(readFileSync(manifest, "utf8")).toBe("broken journal");
  } finally {
    local.dispose();
    rmSync(home, { recursive: true, force: true });
  }
});

test("accepted projections reject older versions and remain fenced when their manifest is absent", () => {
  const home = mkdtempSync(join(tmpdir(), "cueloop-thread-projection-"));
  const local = new DaemonCore(home);

  try {
    const thread = local.sessionCreate({
      workspace: { repoRoot: home, branch: "main" },
      artifact: { type: "plan", content: "Saved local plan", meta: {} },
    });
    const state = new SyncThreadLocalState(home);

    state.begin({ thread, connection, upload: "stable-upload" });
    state.project({ thread: { ...thread, workingCopy: "Accepted remote edit" }, version: 2 });
    expect(() => state.project({ thread, version: 1 })).toThrow("older");
    state.project({ thread: { ...thread, workingCopy: "Accepted remote edit" }, version: 2 });
    rmSync(state.manifestPath(thread.id));
    const recovered = new ThreadStore(home);

    recovered.recover();
    expect(recovered.get(thread.id)?.workingCopy).toBe("Accepted remote edit");
    expect(() => recovered.upsert(thread)).toThrow("authority");
  } finally {
    local.dispose();
    rmSync(home, { recursive: true, force: true });
  }
});

test("an interrupted import preparation retains a writable original until its complete recovery journal is published", async () => {
  const home = mkdtempSync(join(tmpdir(), "cueloop-thread-fence-preparation-"));
  const core = new DaemonCore(home);

  try {
    const thread = core.sessionCreate({
      workspace: { repoRoot: home, branch: "main" },
      artifact: { type: "plan", content: "Retained original plan.\n".repeat(1000), meta: {} },
    });
    const script = join(home, "interrupted-import.ts");

    writeFileSync(
      script,
      `import {DaemonCore} from ${JSON.stringify(join(import.meta.dir, "api.ts"))}; import {SyncThreadLocalState} from ${JSON.stringify(join(import.meta.dir, "sync-thread-local-state.ts"))}; const core=new DaemonCore(${JSON.stringify(home)});new SyncThreadLocalState(${JSON.stringify(home)}).begin({thread:core.sessionGet(${JSON.stringify(thread.id)}),connection:${JSON.stringify(connection)},upload:"retained-upload"});core.dispose();`,
    );
    const child = Bun.spawn(
      [
        "/bin/sh",
        "-c",
        'ulimit -c 0; ulimit -f 1; exec "$@"',
        "sync-import-failure",
        process.execPath,
        script,
      ],
      {
        stdout: "ignore",
        stderr: "ignore",
        env: { ...process.env, BUN_RUNTIME_TRANSPILER_CACHE_PATH: "0" },
      },
    );

    expect(await child.exited).not.toBe(0);
    const recovered = new DaemonCore(home);

    try {
      expect(recovered.sessionGet(thread.id).artifact.content).toBe(thread.artifact.content);
      expect(
        recovered.sessionSetWorkingCopy(thread.id, "Import never reached an authority").workingCopy,
      ).toBe("Import never reached an authority");
    } finally {
      recovered.dispose();
    }
  } finally {
    core.dispose();
    rmSync(home, { recursive: true, force: true });
  }
});

test("a recovered generation requires an explicit projection reset and preserves the full previous projection", () => {
  const home = mkdtempSync(join(tmpdir(), "cueloop-thread-projection-recovery-"));
  const local = new DaemonCore(home);
  const originalAuthority = v.parse(SyncAuthorityIdentitySchema, {
    authorityIdentifier: "019a691a-c6ae-7000-8000-000000000003",
    generation: "019a691a-c6ae-7000-8000-000000000004",
  });
  const recoveredAuthority = v.parse(SyncAuthorityIdentitySchema, {
    ...originalAuthority,
    generation: "019a691a-c6ae-7000-8000-000000000005",
  });

  try {
    const thread = local.sessionCreate({
      workspace: { repoRoot: home, branch: "main" },
      artifact: { type: "plan", content: "Snapshot text", meta: {} },
    });
    const state = new SyncThreadLocalState(home);

    state.begin({ thread, connection, upload: "stable-upload" });
    state.project({
      thread: { ...thread, workingCopy: "Accepted after the backup" },
      version: 9,
      authority: originalAuthority,
    });
    expect(() => state.project({ thread, version: 2, authority: recoveredAuthority })).toThrow(
      "recovery",
    );
    expect(state.readProjection(thread.id).thread.workingCopy).toBe("Accepted after the backup");
    state.project({ thread, version: 2, authority: recoveredAuthority, acceptRecovery: true });
    expect(state.readProjection(thread.id).version).toBe(2);
    expect(state.readProjection(thread.id).authority).toEqual(recoveredAuthority);
    const archives = state.recoveryArchives(thread.id);

    expect(archives).toHaveLength(1);
    expect(JSON.parse(readFileSync(archives[0]!, "utf8"))).toMatchObject({
      version: 9,
      authority: originalAuthority,
      thread: { workingCopy: "Accepted after the backup" },
    });
    expect(() =>
      state.project({ thread, version: 1, authority: recoveredAuthority, acceptRecovery: true }),
    ).toThrow("older");
  } finally {
    local.dispose();
    rmSync(home, { recursive: true, force: true });
  }
});

test("a restored native message stays outside harness delivery and wait responses until a new message is accepted", async () => {
  const home = mkdtempSync(join(tmpdir(), "cueloop-thread-restored-message-"));
  const local = new DaemonCore(home);
  const authority = v.parse(SyncAuthorityIdentitySchema, {
    authorityIdentifier: "019a691a-c6ae-7000-8000-000000000003",
    generation: "019a691a-c6ae-7000-8000-000000000004",
  });
  const restored = v.parse(SyncAuthorityIdentitySchema, {
    ...authority,
    generation: "019a691a-c6ae-7000-8000-000000000005",
  });

  try {
    const thread = local.sessionCreate({
      workspace: { repoRoot: home, branch: "main" },
      artifact: { type: "plan", content: "An approved plan", meta: {} },
    });
    const binding = local.harnessBind({
      threadId: thread.id,
      harness: "claude-code",
      harnessSessionId: "restored-message",
    });
    const accepted = local.sessionSendMessage(thread.id, "approved", "Run this plan");
    const state = new SyncThreadLocalState(home);

    state.begin({ thread: accepted, connection, upload: "saved-upload" });
    local.sessionProjectSyncThread(accepted, 9, { authority });
    expect(local.deliveryPending(binding.id)).toHaveLength(1);
    local.sessionProjectSyncThread(accepted, 2, { authority: restored, acceptRecovery: true });
    expect(local.deliveryPending(binding.id)).toEqual([]);
    expect(() => local.sessionWait(thread.id, 100)).toThrow("requires recovery");
    const message = accepted.message;

    if (!message) throw new Error("Restored native delivery test requires its original message");

    const fresh = { ...accepted, message: { ...message, id: "msg_fresh_after_recovery" } };

    local.sessionProjectSyncThread(fresh, 3, { authority: restored });
    expect(local.deliveryPending(binding.id).map((value) => value.message.id)).toEqual([
      fresh.message.id,
    ]);
    expect((await local.sessionWait(thread.id, 100))?.message?.id).toBe(fresh.message.id);
  } finally {
    local.dispose();
    rmSync(home, { recursive: true, force: true });
  }
});
