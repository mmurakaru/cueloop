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
