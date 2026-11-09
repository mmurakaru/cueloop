import { test } from "bun:test";
import { verifyTestBrowserDraftStorage } from "../helpers/sync-browser";

test.skipIf(process.env.CUELOOP_RUN_SYNC !== "1")(
  "browser drafts survive a full page reload with IndexedDB storage",
  verifyTestBrowserDraftStorage,
  30000,
);
