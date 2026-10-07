import type { AssistantMessage, Message } from "@earendil-works/pi-ai";
import type { AgentEvent, EntryId, EntryRecord, SnapshotEvent } from "@earendil-works/pi-durable";

export class PiAnswerProjection {
  private entries: readonly EntryRecord[] = [];
  private partial?: AssistantMessage;

  constructor(private inputId?: EntryId) {}

  restore(entries: readonly EntryRecord[], snapshot?: SnapshotEvent, inputId?: EntryId): void {
    this.inputId ??= inputId;
    this.entries = entries;
    this.partial = snapshot?.generation?.message
      ? structuredClone(snapshot.generation.message)
      : undefined;
  }

  apply(event: AgentEvent): void {
    if (event.type === "submission" && event.record.type === "input" && event.record.entry)
      this.inputId ??= event.record.entry;

    if (event.type === "message_start")
      this.partial =
        event.message.role === "assistant" ? structuredClone(event.message) : undefined;

    if (event.type === "message_end") {
      this.entries = [...this.entries.filter((entry) => entry.id !== event.entry.id), event.entry];
      this.partial = undefined;
    }

    if (event.type === "message_update")
      for (const change of event.changes) {
        if (change.type === "message") this.partial = structuredClone(change.message);
        else if (this.partial) {
          if (change.type === "block" || "block" in change)
            this.partial.content[change.contentIndex] = structuredClone(change.block);

          if (change.type === "text_delta") {
            const block = this.partial.content[change.contentIndex];

            if (block?.type === "text") block.text += change.delta;
          }
        }
      }
  }

  text(): string {
    if (!this.inputId) return "";

    let text = "";

    for (const entry of [...this.entries].sort((a, b) => a.id - b.id)) {
      if (entry.id <= this.inputId) continue;

      if (entry.model?.some((message) => message.role === "user")) break;

      text += entry.model?.map(assistantText).join("") ?? "";
    }

    return (text + (this.partial ? assistantText(this.partial) : "")).slice(0, 320_000);
  }
}

function assistantText(message: Message): string {
  if (message.role !== "assistant") return "";

  return message.content.flatMap((block) => (block.type === "text" ? [block.text] : [])).join("");
}
