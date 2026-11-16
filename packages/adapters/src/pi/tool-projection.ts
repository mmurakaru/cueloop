import type { AgentHarnessEvent } from "@cueloop/schema";
import type { EntryId, EntryRecord, LiveState } from "@earendil-works/pi-durable";

type PiToolEvent = Extract<AgentHarnessEvent, { kind: "tool" }> & {
  title: string;
  status: "in_progress" | "completed" | "failed";
};

export class PiToolProjection {
  private readonly entries = new Set<EntryId>();
  private readonly tools = new Map<string, PiToolEvent>();

  restore(
    entries: readonly EntryRecord[],
    live: Readonly<LiveState> | undefined,
    inputId: EntryId | undefined,
  ): PiToolEvent[] {
    if (!inputId) return [];

    const events: PiToolEvent[] = [];
    let nextInput = false;
    const publish = (id: string, title: string, status: PiToolEvent["status"]) => {
      if (this.tools.get(id)?.status === status) return;

      const event: PiToolEvent = { kind: "tool", id, title, status };

      this.tools.set(id, event);
      events.push(event);
    };

    for (const entry of entries) {
      if (entry.id <= inputId) continue;

      if (entry.model?.some((message) => message.role === "user")) {
        nextInput = true;
        break;
      }

      if (this.entries.has(entry.id)) continue;

      this.entries.add(entry.id);
      for (const message of entry.model ?? []) {
        if (message.role === "toolResult")
          publish(message.toolCallId, message.toolName, "completed");
      }
    }

    const currentTools = nextInput ? [] : (live?.tools ?? []);

    for (const tool of currentTools) {
      if (tool.status === "pending") continue;

      publish(
        tool.callId,
        tool.name,
        tool.status === "running" ? "in_progress" : tool.entry ? "completed" : "failed",
      );
    }

    for (const tool of this.tools.values()) {
      if (
        tool.status === "in_progress" &&
        !currentTools.some((current) => current.callId === tool.id)
      )
        publish(tool.id, tool.title, "failed");
    }

    return events;
  }
}
