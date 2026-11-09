import { expect, test } from "bun:test";
import * as v from "valibot";
import {
  createSyncTextDocument,
  createSyncTextState,
  mergeSyncTextUpdate,
  SyncTextStateSchema,
  SyncTextUpdateSchema,
} from "@cueloop/sync/text";
import { withTestSyncBrowser } from "../helpers/sync-browser";

test.skipIf(process.env.CUELOOP_RUN_SYNC !== "1")(
  "browser and terminal text updates share the same wire representation",
  async () => {
    const initial = createSyncTextState("Plan 世界 🌍");
    const terminal = createSyncTextDocument({ state: initial.state, canEdit: () => true });

    try {
      terminal.edit({ index: initial.text.length, deleteCount: 0, insert: " from terminal" });
      await withTestSyncBrowser(async (page, moduleUrl) => {
        const result: unknown = await page.evaluate(
          async (options) => {
            const module: typeof import("../fixtures/sync-browser-text.ts") = await import(
              options.moduleUrl
            );

            return module.editBrowserText(options);
          },
          { moduleUrl, state: initial.state, remoteState: terminal.snapshot.state },
        );
        const browser = v.parse(
          v.object({ text: v.string(), state: SyncTextStateSchema, update: SyncTextUpdateSchema }),
          result,
        );
        const merged = mergeSyncTextUpdate({
          state: terminal.snapshot.state,
          update: browser.update,
        });

        expect(browser.text).toBe("Browser: Plan 世界 🌍 from terminal");
        expect(merged.text).toBe(browser.text);
        terminal.receive(browser.state);
        expect(terminal.snapshot.text).toBe(browser.text);
      }, "test/fixtures/sync-browser-text.ts");
    } finally {
      terminal.close();
    }
  },
  30000,
);
