import { appendFileSync, existsSync, mkdirSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { AgentHarnessDiagnostic } from "@cueloop/schema";

/** Store harness diagnostics in a private, bounded log, outside Thread history and model context. */
export function writeHarnessDiagnostic(
  directory: string,
  threadId: string,
  diagnostic: AgentHarnessDiagnostic,
): void {
  const path = join(directory, `${encodeURIComponent(threadId)}.diagnostics.ndjson`);
  const record =
    JSON.stringify({
      at: new Date().toISOString(),
      ...diagnostic,
      severity: diagnostic.severity.slice(0, 128),
      title: diagnostic.title.slice(0, 512),
      text: diagnostic.text.slice(0, 16384),
    }) + "\n";

  try {
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    if (existsSync(path) && statSync(path).size + Buffer.byteLength(record) > 256 * 1024)
      writeFileSync(path, record, { mode: 0o600 });
    else appendFileSync(path, record, { mode: 0o600 });
  } catch {
    // A diagnostic log failure must not change the agent turn outcome.
    console.error("Thread agent diagnostic log could not be written");
  }
}
