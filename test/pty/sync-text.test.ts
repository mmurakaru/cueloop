import { expect } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createSyncTextState } from "@cueloop/sync/text";
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
