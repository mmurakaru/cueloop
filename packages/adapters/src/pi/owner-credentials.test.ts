import { expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ownerCredentialStore } from "./owner-credentials";

test("owner refreshes are serialized and never modify the imported credential source", async () => {
  const directory = mkdtempSync(join(tmpdir(), "cueloop-owner-credentials-"));
  const source = join(directory, "source.json");
  const target = join(directory, "owner.json");
  const original = JSON.stringify({ model: { type: "api_key", key: "source-key" } });

  try {
    writeFileSync(source, original);
    const store = ownerCredentialStore(target, source);

    expect(await store.read("model")).toEqual({ type: "api_key", key: "source-key" });
    await Promise.all([
      store.modify("model", async () => ({ type: "api_key", key: "owner-key" })),
      store.modify("other", async () => ({ type: "api_key", key: "other-key" })),
    ]);
    expect(await store.read("model")).toEqual({ type: "api_key", key: "owner-key" });
    expect(await store.read("other")).toEqual({ type: "api_key", key: "other-key" });
    expect(readFileSync(source, "utf8")).toBe(original);
    expect(statSync(target).mode & 0o777).toBe(0o600);
    await store.delete("model");
    expect(await store.read("model")).toBeUndefined();
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
