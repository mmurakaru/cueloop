const STARTUP_PREFIXES = [
  "[context] skill catalog shortened ",
  "skill discovery warning: candidate ",
];
const MAX_PENDING_BYTES = 32768;
const MAX_TRACKED_MESSAGES = 128;

type MessageDisposition = { kind: "pending"; text: string } | { kind: "answer" };

/** Legacy fx lacks provenance: recognize bounded, complete notices, never classify a whole ID. */
export class FxLegacyStartupMessages {
  private readonly messages = new Map<string, MessageDisposition>();

  constructor(private readonly onDiagnostic: (text: string) => void) {}

  /** This compatibility heuristic cannot distinguish an exact model quotation from a notice. */
  push(id: string | undefined, text: string): string | undefined {
    const previous = id === undefined ? undefined : this.messages.get(id);

    if (
      previous?.kind === "answer" ||
      (previous === undefined && this.messages.size >= MAX_TRACKED_MESSAGES)
    )
      return text;

    let remaining = (previous?.text ?? "") + text;

    while (remaining) {
      const newline = remaining.indexOf("\n");
      const line = newline < 0 ? remaining : remaining.slice(0, newline + 1);

      if (newline >= 0 && isLegacyStartupNotice(line)) {
        this.onDiagnostic(line);
        remaining = remaining.slice(newline + 1);
        continue;
      }

      const couldBeNotice = STARTUP_PREFIXES.some(
        (prefix) => line.startsWith(prefix) || prefix.startsWith(line),
      );

      if (
        id !== undefined &&
        newline < 0 &&
        couldBeNotice &&
        Buffer.byteLength(line) < MAX_PENDING_BYTES
      ) {
        this.messages.set(id, { kind: "pending", text: remaining });

        return undefined;
      }

      if (id !== undefined) this.messages.set(id, { kind: "answer" });

      return remaining;
    }

    if (id !== undefined) this.messages.delete(id);

    return undefined;
  }

  /** Unfinished or unrecognized text is preserved when a turn settles, including cancellation. */
  finish(): { id: string; text: string }[] {
    const remaining = [...this.messages].flatMap(([id, state]) =>
      state.kind === "pending" && state.text ? [{ id, text: state.text }] : [],
    );

    this.messages.clear();

    return remaining;
  }
}

function isLegacyStartupNotice(line: string): boolean {
  return (
    /^\[context\] skill catalog shortened \d+ descriptions: effective=\d+ bytes source=compiled default\r?\n$/.test(
      line,
    ) ||
    (line.startsWith("skill discovery warning: candidate ") &&
      line.includes(
        "was skipped because its linked skill directory could not be resolved to an authorized readable directory",
      ) &&
      line.endsWith("; relaunch with FX_TRACE=1 to write a trace log\n"))
  );
}
