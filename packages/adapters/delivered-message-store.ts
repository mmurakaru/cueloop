/** Adapter-local Message ID journal for deduplicating native injection after reload. */

import {
  closeSync,
  openSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
  writeSync,
} from "node:fs";
import * as v from "valibot";
import type { Message } from "@cueloop/schema";

const DeliveredMessageIdsSchema = v.array(v.pipe(v.string(), v.minLength(1)));
const FileErrorSchema = v.object({ code: v.string() });

/** Persisted IDs make a successful native send harmless to repeat after an ack failure. */
export class DeliveredMessageStore {
  constructor(private readonly path: string) {
    this.load();
  }

  /** Call native injection once per Message ID; record success before daemon acknowledgement. */
  async sendOnce(
    message: Message,
    inject: (message: Message) => void | Promise<void>,
  ): Promise<void> {
    const unlock = await this.lock();

    try {
      const ids = new Set(this.load());

      if (ids.has(message.id)) return;

      await inject(message);
      ids.add(message.id);
      this.persist(ids);
    } finally {
      unlock();
    }
  }

  private async lock(): Promise<() => void> {
    const lockPath = this.path + ".lock";
    const deadline = Date.now() + 30_000;

    for (;;) {
      try {
        const descriptor = openSync(lockPath, "wx");

        try {
          writeSync(descriptor, String(process.pid));
        } catch (error) {
          closeSync(descriptor);
          unlinkSync(lockPath);

          throw error;
        }
        closeSync(descriptor);

        return () => unlinkSync(lockPath);
      } catch (error) {
        const parsed = v.safeParse(FileErrorSchema, error);

        if (!parsed.success || parsed.output.code !== "EEXIST") throw error;
        if (this.reapAbandonedLock(lockPath)) continue;
        if (Date.now() >= deadline)
          throw new Error(`timed out waiting for Message journal ${this.path}`);

        await Bun.sleep(25);
      }
    }
  }

  private reapAbandonedLock(lockPath: string): boolean {
    try {
      const before = statSync(lockPath);
      const ownerPid = Number(readFileSync(lockPath, "utf8"));

      if (Number.isSafeInteger(ownerPid) && ownerPid > 0) {
        try {
          process.kill(ownerPid, 0);

          return false;
        } catch (error) {
          const parsed = v.safeParse(FileErrorSchema, error);

          if (!parsed.success || parsed.output.code !== "ESRCH") return false;
        }
      } else if (Date.now() - before.mtimeMs < 5_000) {
        return false;
      }
      if (statSync(lockPath).ino !== before.ino) return false;

      unlinkSync(lockPath);

      return true;
    } catch {
      return false;
    }
  }

  private persist(ids: Set<string>): void {
    const temporaryPath = `${this.path}.${process.pid}.${crypto.randomUUID()}.tmp`;

    writeFileSync(temporaryPath, JSON.stringify([...ids]));
    renameSync(temporaryPath, this.path);
  }

  private load(): string[] {
    let serialized: string;

    try {
      serialized = readFileSync(this.path, "utf8");
    } catch (error) {
      const parsed = v.safeParse(FileErrorSchema, error);

      if (parsed.success && parsed.output.code === "ENOENT") return [];

      throw error;
    }

    return v.parse(DeliveredMessageIdsSchema, JSON.parse(serialized));
  }
}
