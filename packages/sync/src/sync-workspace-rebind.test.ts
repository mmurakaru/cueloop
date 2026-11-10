import { expect, test, spyOn } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as v from "valibot";
import { createSyncDraftStore } from "./sync-draft-store.ts";
import { createSyncSqliteStorage } from "./sync-sqlite-storage.ts";
import { defineSyncOperation } from "./sync-operation.ts";
import { rebindSyncWorkspace } from "./sync-workspace-rebind.ts";

test("rebind selects application drafts and cannot copy another workspace's submitted operations", async () => {
  const directory = mkdtempSync(join(tmpdir(), "cueloop-rebind-scope-"));
  const storage = createSyncSqliteStorage({ directory });
  const source = createSyncDraftStore({
    storage,
    authorityIdentifier: "source",
    userIdentifier: "owner",
  });
  const target = createSyncDraftStore({
    storage,
    authorityIdentifier: "target",
    userIdentifier: "owner",
    maximumItems: 2,
  });
  const first = "019a691a-c6ae-7000-8000-000000000001";
  const second = "019a691a-c6ae-7000-8000-000000000002";
  const operation = defineSyncOperation({
    name: "comment.add",
    version: 1,
    arguments: v.object({ body: v.string() }),
  });
  const authority = {
    authorityIdentifier: "019a691a-c6ae-7000-8000-000000000003",
    generation: "019a691a-c6ae-7000-8000-000000000004",
    workspaceIdentifier: first,
    workspaceGeneration: "019a691a-c6ae-7000-8000-000000000005",
  };
  const discovery = spyOn(globalThis, "fetch").mockImplementation(
    Object.assign(async () => Response.json(authority), {
      preconnect: globalThis.fetch.preconnect,
    }),
  );

  try {
    for (const workspaceIdentifier of [first, second]) {
      const draft = await source.save({ content: "Pending operation" });

      await source.markSubmitted({
        draftIdentifier: draft.draftIdentifier,
        operation: operation.create({
          workspaceIdentifier,
          arguments: { body: "Uncertain input" },
        }),
      });
      await source.save({ content: { workspaceIdentifier, body: "Unsent application input" } });
    }

    const records = await source.list();
    const options = {
      authorityURL: "https://example.test",
      workspaceIdentifier: first,
      headers: {},
      sourceDrafts: source,
      targetDrafts: target,
      selectDraft: (draft: (typeof records)[number]) =>
        draft.status !== "draft" ||
        v.is(v.object({ workspaceIdentifier: v.literal(first) }), draft.content),
      lookup: async () => undefined,
    };
    const rebound = await rebindSyncWorkspace(options);
    const selected = await target.list();

    expect(selected).toHaveLength(2);
    expect(
      selected
        .filter((draft) => draft.status === "pending")
        .map((draft) => draft.operation.workspaceIdentifier),
    ).toEqual([first]);
    expect(selected.find((draft) => draft.status === "draft")?.content).toMatchObject({
      workspaceIdentifier: first,
    });
    expect(rebound.pending.map(({ outcome }) => outcome.status)).toEqual(["pending"]);
    await rebindSyncWorkspace(options);
    expect(await target.list()).toEqual(selected);
    expect(await source.list()).toEqual(records);
  } finally {
    discovery.mockRestore();
    await source.close();
    await target.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
