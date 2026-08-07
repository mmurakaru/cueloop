/** TUI launcher. The App lands with the client slice; this wires it to a real terminal. */

export interface RunClientOptions {
  sessionId?: string;
  home?: string;
}

export async function runClient(_opts: RunClientOptions): Promise<number> {
  console.error("cueloop TUI: client slice not wired yet");
  return 1;
}
