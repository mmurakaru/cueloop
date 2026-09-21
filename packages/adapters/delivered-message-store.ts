/** Adapter-local Message ID journal for deduplicating native injection after reload. */

import { readFileSync, renameSync, writeFileSync } from "node:fs";
import * as v from "valibot";
import type { Message } from "@cueloop/schema";

const DeliveredMessageIdsSchema = v.array(v.pipe(v.string(), v.minLength(1)));
const FileErrorSchema = v.object({ code: v.string() });

/** Persisted IDs make a successful native send harmless to repeat after an ack failure. */
export class DeliveredMessageStore {
  private readonly ids: Set<string>;

  constructor(private readonly path: string) {
    this.ids = new Set(this.load());
  }

  /** Call native injection once per Message ID; record success before daemon acknowledgement. */
  async sendOnce(
    message: Message,
    inject: (message: Message) => void | Promise<void>,
  ): Promise<void> {
    if (this.ids.has(message.id)) {
      this.persist();

      return;
    }

    await inject(message);
    this.ids.add(message.id);
    this.persist();
  }

  private persist(): void {
    const temporaryPath = this.path + ".tmp";

    writeFileSync(temporaryPath, JSON.stringify([...this.ids]));
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
