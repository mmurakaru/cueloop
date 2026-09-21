/** Ghostty terminal IDs persist outside canonical Threads. */

import { readFileSync, renameSync, writeFileSync } from "node:fs";
import * as v from "valibot";
import { ghosttyThreadSurfacesPath } from "./paths";

export interface GhosttyThreadSurfaceHandle {
  terminalId: string;
}

const HandleSchema = v.object({ terminalId: v.string() });
const MapSchema = v.record(v.string(), v.unknown());

export class GhosttyThreadSurfaceStore {
  private surfaces = new Map<string, GhosttyThreadSurfaceHandle>();
  private readonly path: string;

  constructor(home: string) {
    this.path = ghosttyThreadSurfacesPath(home);
    this.load();
  }

  private load(): void {
    try {
      const parsed = v.parse(MapSchema, JSON.parse(readFileSync(this.path, "utf8")));

      for (const [threadId, value] of Object.entries(parsed)) {
        const handle = v.safeParse(HandleSchema, value);

        if (handle.success) this.surfaces.set(threadId, handle.output);
      }
    } catch {
      // Scratch corruption cannot change a pending Thread.
    }
  }

  private persist(): void {
    const tempPath = this.path + ".tmp";

    writeFileSync(tempPath, JSON.stringify(Object.fromEntries(this.surfaces), null, 2));
    renameSync(tempPath, this.path);
  }

  get(threadId: string): GhosttyThreadSurfaceHandle | null {
    return this.surfaces.get(threadId) ?? null;
  }

  set(threadId: string, handle: GhosttyThreadSurfaceHandle): void {
    this.surfaces.set(threadId, handle);
    this.persist();
  }

  delete(threadId: string): void {
    if (this.surfaces.delete(threadId)) this.persist();
  }
}
