import { expect } from "bun:test";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { createSyncTextState, createSyncTextDocument } from "@cueloop/sync/text";
import { ptyTest } from "../helpers/pty-reviews";
import { launchTuiSession } from "../helpers/pty-tui-session";

ptyTest("the experimental sync editor saves through the public application contract", async () => {
  const home = mkdtempSync(join(tmpdir(), "cueloop-sync-editor-pty-"));
  const application = join(home, "application.ts");
  const saved = join(home, "saved.txt");
  const closed = join(home, "closed.txt");
  const snapshot = {
    text: "Plan",
    textState: createSyncTextState("Plan").state,
    connection: "connected",
    freshness: "complete",
    lifecycle: "active",
    operation: "idle",
    saving: false,
    draftSaved: false,
    editable: true,
  };

  writeFileSync(join(home, "no-config.toml"), "[experimental]\nsync = true\n");
  writeFileSync(
    application,
    `import { appendFileSync, writeFileSync } from "node:fs";
let snapshot = ${JSON.stringify(snapshot)};
const listeners = new Set();
export const syncApplication = {
  fetch: () => new Response("ok"),
  openText: async () => ({
    getSnapshot: () => snapshot,
    subscribe: listener => { listeners.add(listener); return () => listeners.delete(listener); },
    change: text => { snapshot = { ...snapshot, text, draftSaved: true }; for (const listener of listeners) listener(); },
    save: async () => { writeFileSync(${JSON.stringify(saved)}, snapshot.text); return { status: "unchanged" }; },
    close: async () => appendFileSync(${JSON.stringify(closed)}, "session\\n"),
  }),
  close: async () => appendFileSync(${JSON.stringify(closed)}, "application\\n"),
};`,
  );
  const session = launchTuiSession({
    home,
    cwd: home,
    args: ["sync", "edit", "--application", application],
    cols: 90,
    rows: 16,
  });

  try {
    await session.waitForReady();
    await session.waitForText("Shared plan");
    await session.type("Team ");
    await session.waitForText("Team Plan");
    await session.press(["ctrl", "enter"]);
    await session.waitForExit();
    expect(readFileSync(saved, "utf8")).toBe("Team Plan");
    expect(readFileSync(closed, "utf8")).toBe("session\napplication\n");
    expect(session.exit()?.exitCode).toBe(0);
  } finally {
    await session.close();
    rmSync(home, { recursive: true, force: true });
  }
});

ptyTest("remote text preserves a held selection through the real terminal", async () => {
  const home = mkdtempSync(join(tmpdir(), "cueloop-sync-selection-pty-"));
  const application = join(home, "application.ts");
  const remotePath = join(home, "remote.json");
  const saved = join(home, "saved.txt");
  const initial = createSyncTextState("Plan");
  const remote = createSyncTextDocument({ state: initial.state, canEdit: () => true });

  mkdirSync(join(home, "node_modules", "@cueloop"), { recursive: true });
  symlinkSync(resolve("packages/sync"), join(home, "node_modules", "@cueloop", "sync"), "dir");
  writeFileSync(join(home, "no-config.toml"), "[experimental]\nsync = true\n");
  writeFileSync(remotePath, JSON.stringify(initial));
  writeFileSync(
    application,
    `import { readFileSync, watchFile, unwatchFile, writeFileSync } from "node:fs";
import { createSyncTextDocument } from "@cueloop/sync/text";
const document = createSyncTextDocument({ state: ${JSON.stringify(initial.state)}, canEdit: () => true });
let snapshot = { text: "Plan", textState: document.snapshot.state, connection: "connected", freshness: "complete", lifecycle: "active", operation: "idle", saving: false, draftSaved: false, editable: true };
const listeners = new Set();
const publish = () => { for (const listener of listeners) listener(); };
watchFile(${JSON.stringify(remotePath)}, { interval: 20 }, () => {
  document.receive(JSON.parse(readFileSync(${JSON.stringify(remotePath)}, "utf8")).state);
  snapshot = { ...snapshot, text: document.snapshot.text, textState: document.snapshot.state };
  publish();
});
export const syncApplication = {
  fetch: () => new Response("ok"),
  openText: async () => ({
    getSnapshot: () => snapshot,
    subscribe: listener => { listeners.add(listener); return () => listeners.delete(listener); },
    change: text => { document.replace(text); snapshot = { ...snapshot, text, textState: document.snapshot.state }; publish(); },
    save: async () => { writeFileSync(${JSON.stringify(saved)}, snapshot.text); return { status: "unchanged" }; },
    close: async () => { unwatchFile(${JSON.stringify(remotePath)}); document.close(); },
  }),
};`,
  );
  const session = launchTuiSession({
    home,
    cwd: home,
    args: ["sync", "edit", "--application", application],
    cols: 90,
    rows: 16,
  });

  try {
    await session.waitForReady();
    await session.waitForText("Plan");
    await session.press("end");

    for (const key of ["left", "left", "left", "left"] as const)
      await session.press(["shift", key]);

    await session.waitForText("Col 1");
    const update = remote.edit({ index: 0, deleteCount: 0, insert: "Shared " });
    const nextPath = join(home, "remote-next.json");

    writeFileSync(nextPath, JSON.stringify(update));
    renameSync(nextPath, remotePath);
    await session.waitForText("Shared Plan");
    await session.type("X");
    await session.waitForText("Shared X");
    await session.press(["ctrl", "enter"]);
    await session.waitForExit();
    expect(readFileSync(saved, "utf8")).toBe("Shared X");
  } finally {
    await session.close();
    remote.close();
    rmSync(home, { recursive: true, force: true });
  }
});
