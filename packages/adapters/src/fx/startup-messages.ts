const STARTUP_PREFIXES = [
  "[context] skill catalog shortened ",
  "skill discovery warning: candidate ",
];

type MessageDisposition =
  | { kind: "pending"; text: string }
  | { kind: "answer" }
  | { kind: "startup" };

/** Fx uses separate message IDs for operational notices and model answers. */
export class FxStartupMessages {
  private readonly messages = new Map<string, MessageDisposition>();

  /** Identify only known startup prefixes; subsequent chunks follow their message's disposition. */
  push(id: string | undefined, text: string): string | undefined {
    if (id === undefined) {
      return STARTUP_PREFIXES.some((prefix) => text.startsWith(prefix)) ? undefined : text;
    }
    const previous = this.messages.get(id);

    if (previous?.kind === "startup") return undefined;
    if (previous?.kind === "answer") return text;
    const combined = (previous?.text ?? "") + text;

    if (STARTUP_PREFIXES.some((prefix) => combined.startsWith(prefix))) {
      this.messages.set(id, { kind: "startup" });

      return undefined;
    }
    if (STARTUP_PREFIXES.some((prefix) => prefix.startsWith(combined))) {
      this.messages.set(id, { kind: "pending", text: combined });

      return undefined;
    }
    this.messages.set(id, { kind: "answer" });

    return combined;
  }

  /** A short answer resembling a prefix must not disappear when the turn ends. */
  finish(): { id: string; text: string }[] {
    const remaining = [...this.messages].flatMap(([id, state]) =>
      state.kind === "pending" && state.text ? [{ id, text: state.text }] : [],
    );

    this.messages.clear();

    return remaining;
  }
}
