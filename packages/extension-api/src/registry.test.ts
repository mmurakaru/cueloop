import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Registry } from "./registry";
import { loadExtensions, readTrust } from "./loader";
import type { ReviewSession } from "@cueloop/schema";

const SESSION = { id: "ses_x", annotations: [] } as unknown as ReviewSession;

describe("Registry", () => {
  test("captures registrations per extension; first wins", async () => {
    const reg = new Registry();
    await reg.load("builtin", (api) => {
      api.registerRenderer("plan", () => [[{ text: "builtin" }]]);
    });
    await reg.load("third-party", (api) => {
      api.registerRenderer("plan", () => [[{ text: "override-attempt" }]]);
      api.registerRenderer("svg", () => [[{ text: "svg" }]]);
    });
    expect(reg.rendererFor("plan")!({ content: "", meta: {} }, 80)[0]![0]!.text).toBe("builtin");
    expect(reg.rendererFor("svg")).toBeDefined();
  });

  test("a throwing factory is contained, not fatal", async () => {
    const reg = new Registry();
    const record = await reg.load("broken", () => {
      throw new Error("boom");
    });
    expect(record.errors).toEqual(["boom"]);
    expect(reg.extensions.length).toBe(1);
  });

  test("reserved keybindings are rejected with attribution", async () => {
    const reg = new Registry();
    const record = await reg.load("greedy", (api) => {
      api.registerKeybinding({ action: "steal", defaultKeys: ["j"], handler: () => {} });
      api.registerKeybinding({ action: "fine", defaultKeys: ["F5"], handler: () => {} });
    });
    expect(record.keybindings.length).toBe(1);
    expect(record.errors[0]).toContain('"j" is reserved');
  });

  test("observers never cancel and never crash the host", async () => {
    const reg = new Registry();
    const seen: string[] = [];
    await reg.load("observer", (api) => {
      api.on("session.resolved", () => {
        throw new Error("observer bug");
      });
      api.on("session.resolved", (s) => seen.push(s.id));
    });
    reg.emit("session.resolved", SESSION);
    expect(seen).toEqual(["ses_x"]);
  });
});

describe("loadExtensions", () => {
  test("loads user extensions; repo extensions gated by trust", async () => {
    const dir = mkdtempSync(join(tmpdir(), "cueloop-ext-"));
    const userDir = join(dir, "user-ext");
    const repoRoot = join(dir, "repo");
    const home = join(dir, "home");
    mkdirSync(userDir, { recursive: true });
    mkdirSync(join(repoRoot, ".cueloop", "extensions"), { recursive: true });
    writeFileSync(
      join(userDir, "hello.ts"),
      `export default (api) => { api.registerCommand("hello", { description: "hi", handler() {} }); };`,
    );
    writeFileSync(
      join(repoRoot, ".cueloop", "extensions", "repo-ext.ts"),
      `export default (api) => { api.registerCommand("repo", { description: "r", handler() {} }); };`,
    );
    try {
      // untrusted repo: user loads, repo skipped
      const reg1 = new Registry();
      const r1 = await loadExtensions({ registry: reg1, userDir, repoRoot, home });
      expect(r1.loaded.length).toBe(1);
      expect(r1.skipped.length).toBe(1);
      expect(reg1.commandFor("hello")).toBeDefined();
      expect(reg1.commandFor("repo")).toBeUndefined();

      // trust granted through the resolver: repo loads and persists
      const reg2 = new Registry();
      const r2 = await loadExtensions({ registry: reg2, userDir, repoRoot, home, confirmTrust: async () => true });
      expect(r2.loaded.length).toBe(2);
      expect(reg2.commandFor("repo")).toBeDefined();
      expect(readTrust(home).trusted).toContain(repoRoot);

      // persisted: no resolver needed next time
      const reg3 = new Registry();
      const r3 = await loadExtensions({ registry: reg3, userDir, repoRoot, home });
      expect(r3.loaded.length).toBe(2);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
