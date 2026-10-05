import { expect, test } from "bun:test";
import { packSessionBlob } from "@cueloop/daemon/share-blob";
import type { Thread } from "@cueloop/schema";
import { unpackGatewayShare } from "./gateway-share-blob";

const thread: Thread = {
  schemaVersion: "1",
  id: "ses_1",
  workspace: { repoRoot: "/repo", branch: "main" },
  artifact: { type: "plan", content: "Plan", meta: {} },
  revisions: [],
  annotations: [],
  message: null,
  status: "pending",
  createdAt: "now",
  shares: [{ id: "p_test", owner: "SHA256:owner", requireAuth: true, allowlist: [] }],
};

test("stored shares retain their private policy and owner", () => {
  expect(unpackGatewayShare(packSessionBlob(thread), "p_test")).toEqual(thread);
});

test("stored shares fail closed without one owned link matching the storage key", () => {
  for (const shares of [
    undefined,
    [],
    [{ id: "p_test", requireAuth: false, allowlist: [] }],
    [...thread.shares!, ...thread.shares!],
  ]) {
    expect(() => unpackGatewayShare(packSessionBlob({ ...thread, shares }), "p_test")).toThrow(
      "gateway share metadata",
    );
  }
  expect(() => unpackGatewayShare(packSessionBlob(thread), "p_other")).toThrow(
    "gateway share metadata",
  );
});
