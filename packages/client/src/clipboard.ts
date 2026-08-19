/**
 * Best-effort system clipboard. Each platform has its own tool; we try them in
 * order and report whether one worked, so the caller can fall back to printing
 * the line (the over-SSH case, where no clipboard tool exists). Mirrors how
 * herdr confirms a copy.
 */

/** The clipboard-write commands to try, most-preferred first, for this platform. */
export function clipboardCommands(platform: NodeJS.Platform = process.platform): string[][] {
  if (platform === "darwin") return [["pbcopy"]];
  if (platform === "win32") return [["clip.exe"]];
  return [["wl-copy"], ["xclip", "-selection", "clipboard"], ["xsel", "--clipboard", "--input"]];
}

/** Copy `text` to the clipboard; false when no tool is available or all fail. */
export async function copyToClipboard(text: string): Promise<boolean> {
  for (const command of clipboardCommands()) {
    try {
      const proc = Bun.spawn(command, {
        stdin: Buffer.from(text),
        stdout: "ignore",
        stderr: "ignore",
      });
      if ((await proc.exited) === 0) return true;
    } catch {
      // tool not installed - try the next one
    }
  }
  return false;
}
