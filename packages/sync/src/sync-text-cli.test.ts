import { expect, test } from "bun:test";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { runSyncCli } from "./sync-cli.ts";
import { createSyncTextState } from "./sync-text.ts";

test("an application text editor receives its arguments and releases its session before the application", async () => {
  const directory = mkdtempSync(join(tmpdir(), "cueloop-sync-text-cli-"));
  const modulePath = join(directory, "application.ts");
  const events = join(directory, "events.txt");
  const argumentsPath = join(directory, "arguments.json");
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

  writeFileSync(
    modulePath,
    `import { appendFileSync, writeFileSync } from "node:fs";
const snapshot = ${JSON.stringify(snapshot)};
export const syncApplication = {
  fetch: () => new Response("ok"),
  openText: async arguments_ => {
    writeFileSync(${JSON.stringify(argumentsPath)}, JSON.stringify(arguments_));
    return { getSnapshot: () => snapshot, subscribe: () => () => {}, change() {}, save: async () => ({ status: "unchanged" }), close: async () => appendFileSync(${JSON.stringify(events)}, "session\\n") };
  },
  close: async () => appendFileSync(${JSON.stringify(events)}, "application\\n"),
};`,
  );

  try {
    const result = await runSyncCli(["edit", "--application", modulePath, "--record", "record-1"], {
      renderTextEditor: async (session) => {
        expect(session.getSnapshot().text).toBe("Plan");
        expect((await session.save()).status).toBe("unchanged");
      },
    });

    expect(result).toBe(0);
    expect(JSON.parse(readFileSync(argumentsPath, "utf8"))).toEqual(["--record", "record-1"]);
    expect(readFileSync(events, "utf8")).toBe("session\napplication\n");
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
