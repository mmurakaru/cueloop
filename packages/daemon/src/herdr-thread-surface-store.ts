/** Herdr handles persist outside canonical Threads in one atomic JSON map. */

import { readFileSync, renameSync, writeFileSync } from "node:fs";
import * as v from "valibot";
import { herdrThreadSurfacesPath } from "./paths";

/** Herdr-native handle; pane focus needs its original left-hand pane. */
export type HerdrThreadSurfaceHandle =
  | { mode?: "tab"; tabId: string; paneId: string }
  | { mode: "pane"; tabId: string; paneId: string; sourcePaneId: string };

const HerdrThreadTabHandleSchema = v.object({
  tabId: v.string(),
  paneId: v.string(),
  mode: v.optional(v.literal("tab")),
});
const HerdrThreadPaneHandleSchema = v.object({
  tabId: v.string(),
  paneId: v.string(),
  mode: v.literal("pane"),
  sourcePaneId: v.string(),
});
const HerdrThreadSurfaceHandleSchema = v.union([
  HerdrThreadTabHandleSchema,
  HerdrThreadPaneHandleSchema,
]);
const HerdrThreadSurfaceMapSchema = v.record(v.string(), v.unknown());

export class HerdrThreadSurfaceStore {
  private surfaces = new Map<string, HerdrThreadSurfaceHandle>();
  private readonly path: string;

  constructor(home: string) {
    this.path = herdrThreadSurfacesPath(home);
    this.load();
  }

  private load(): void {
    try {
      const parsed = v.parse(
        HerdrThreadSurfaceMapSchema,
        JSON.parse(readFileSync(this.path, "utf8")),
      );

      for (const [sessionId, value] of Object.entries(parsed)) {
        const handle = v.safeParse(HerdrThreadSurfaceHandleSchema, value);

        if (handle.success) this.surfaces.set(sessionId, handle.output);
      }
    } catch {
      // A missing or corrupt side-store cannot block a pending Thread.
    }
  }

  private persist(): void {
    const tempPath = this.path + ".tmp";

    writeFileSync(tempPath, JSON.stringify(Object.fromEntries(this.surfaces), null, 2));
    renameSync(tempPath, this.path);
  }

  get(sessionId: string): HerdrThreadSurfaceHandle | null {
    return this.surfaces.get(sessionId) ?? null;
  }

  set(sessionId: string, handle: HerdrThreadSurfaceHandle): void {
    this.surfaces.set(sessionId, handle);
    this.persist();
  }

  delete(sessionId: string): void {
    if (this.surfaces.delete(sessionId)) this.persist();
  }
}
