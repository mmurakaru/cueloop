import type { AssistantMessage, Message } from "@earendil-works/pi-ai";
import type { EntryId, EntryRecord, LiveState } from "@earendil-works/pi-durable";

export class PiAnswerProjection {
  private readonly entries = new Map<EntryId, EntryRecord>();
  private partial?: AssistantMessage;

  constructor(private inputId?: EntryId) {}

  restore(entries: readonly EntryRecord[], live?: Readonly<LiveState>, inputId?: EntryId): void {
    this.inputId ??= inputId;
    for (const entry of entries) this.entries.set(entry.id, entry);
    this.partial = live?.generation?.message ? structuredClone(live.generation.message) : undefined;
  }

  text(): string {
    if (!this.inputId) return "";

    let text = "";

    for (const entry of [...this.entries.values()].sort((a, b) => a.id - b.id)) {
      if (entry.id <= this.inputId) continue;

      if (entry.model?.some((message) => message.role === "user")) return text.slice(0, 320_000);

      text += entry.model?.map(assistantText).join("") ?? "";
    }

    return (text + (this.partial ? assistantText(this.partial) : "")).slice(0, 320_000);
  }
}

function assistantText(message: Message): string {
  if (message.role !== "assistant") return "";

  return message.content.flatMap((block) => (block.type === "text" ? [block.text] : [])).join("");
}
