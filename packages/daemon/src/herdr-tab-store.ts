/**
 * herdr adapter scratch, kept out of the core session record: the tab cueloop
 * opened to render each review, keyed by session id. One JSON map, atomic write.
 * The core `ReviewSession` never mentions herdr; this side-store is the whole
 * leak boundary.
 */

import { readFileSync, renameSync, writeFileSync } from "node:fs";
import { herdrTabsPath } from "./paths";

/** The tab and its root pane: pane id checks liveness, tab id focuses it. */
export interface HerdrTabHandle {
  tabId: string;
  paneId: string;
}

export class HerdrTabStore {
  private tabs = new Map<string, HerdrTabHandle>();
  private readonly path: string;

  constructor(home: string) {
    this.path = herdrTabsPath(home);
    this.load();
  }

  private load(): void {
    try {
      const parsed = JSON.parse(readFileSync(this.path, "utf8")) as Record<string, HerdrTabHandle>;
      for (const [sessionId, handle] of Object.entries(parsed)) {
        if (handle?.tabId && handle?.paneId) this.tabs.set(sessionId, handle);
      }
    } catch {
      // absent or unreadable: start empty - a stale tab just reopens on resubmit
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
