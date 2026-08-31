/**
 * herdr adapter scratch, kept out of the core session record: the tab cueloop
 * opened to render each review, keyed by session id. One JSON map, atomic write.
 * The core `ReviewSession` never mentions herdr; this side-store is the whole
 * leak boundary.
 */

import { readFileSync, renameSync, writeFileSync } from "node:fs";
import * as v from "valibot";
import { herdrTabsPath } from "./paths";

/** The tab and its root pane: pane id checks liveness, tab id focuses it. */
export interface HerdrTabHandle {
  tabId: string;
  paneId: string;
}

const HerdrTabHandleSchema = v.object({
  tabId: v.string(),
  paneId: v.string(),
});
const HerdrTabsSchema = v.record(v.string(), v.unknown());

export class HerdrTabStore {
  private tabs = new Map<string, HerdrTabHandle>();
  private readonly path: string;

  constructor(home: string) {
    this.path = herdrTabsPath(home);
    this.load();
  }

  private load(): void {
    try {
      const parsed = v.parse(HerdrTabsSchema, JSON.parse(readFileSync(this.path, "utf8")));

      for (const [sessionId, value] of Object.entries(parsed)) {
        const handle = v.safeParse(HerdrTabHandleSchema, value);

        if (handle.success) this.tabs.set(sessionId, handle.output);
      }
    } catch {
      // absent, unreadable, or malformed: start empty - a stale tab just reopens on resubmit
    }
  }

  private persist(): void {
    const tempPath = this.path + ".tmp";

    writeFileSync(tempPath, JSON.stringify(Object.fromEntries(this.tabs), null, 2));
    renameSync(tempPath, this.path);
  }

  get(sessionId: string): HerdrTabHandle | null {
    return this.tabs.get(sessionId) ?? null;
  }

  set(sessionId: string, handle: HerdrTabHandle): void {
    this.tabs.set(sessionId, handle);
    this.persist();
  }

  delete(sessionId: string): void {
    if (this.tabs.delete(sessionId)) this.persist();
  }
}
