/** Ghostty terminal IDs persist outside canonical Threads. */

import { readFileSync, renameSync, writeFileSync } from "node:fs";
import * as v from "valibot";
import { ghosttyThreadSurfacesPath } from "./paths";

export interface GhosttyThreadSurfaceHandle {
  terminalId: string;
}

interface GhosttyThreadSurfaceRecord {
  terminalId?: string;
  opening?: true;
}

const RecordSchema = v.object({
  terminalId: v.optional(v.string()),
  opening: v.optional(v.literal(true)),
});
const MapSchema = v.record(v.string(), v.unknown());

export class GhosttyThreadSurfaceStore {
  private surfaces = new Map<string, GhosttyThreadSurfaceRecord>();
  private readonly path: string;

  constructor(home: string) {
    this.path = ghosttyThreadSurfacesPath(home);
    this.load();
  }

  private load(): void {
    try {
      const parsed = v.parse(MapSchema, JSON.parse(readFileSync(this.path, "utf8")));

      for (const [threadId, value] of Object.entries(parsed)) {
        const handle = v.safeParse(RecordSchema, value);

        if (handle.success) {
          const record = handle.output;

          this.surfaces.set(
            threadId,
            record.opening && record.terminalId ? { terminalId: record.terminalId } : record,
          );
        }
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
    const terminalId = this.surfaces.get(threadId)?.terminalId;

    return terminalId ? { terminalId } : null;
  }

  /** Persist a launch reservation before any AppleScript surface can be created. */
  claim(threadId: string): boolean {
    const previous = this.surfaces.get(threadId);

    if (previous?.opening) return false;
    this.surfaces.set(threadId, { ...previous, opening: true });

    try {
      this.persist();

      return true;
    } catch (error) {
      if (previous) this.surfaces.set(threadId, previous);
      else this.surfaces.delete(threadId);

      throw error;
    }
  }

  release(threadId: string): void {
    const record = this.surfaces.get(threadId);

    if (!record?.opening) return;
    if (record.terminalId) this.surfaces.set(threadId, { terminalId: record.terminalId });
    else this.surfaces.delete(threadId);
    this.persist();
  }

  set(threadId: string, handle: GhosttyThreadSurfaceHandle): void {
    const opening = this.surfaces.get(threadId)?.opening;

    this.surfaces.set(threadId, opening ? { ...handle, opening } : handle);
    this.persist();
  }

  delete(threadId: string): void {
    if (this.surfaces.delete(threadId)) this.persist();
  }
}
