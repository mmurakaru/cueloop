import { mkdirSync, readFileSync, readdirSync, unlinkSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
import * as v from "valibot";

const CodexSessionSchema = v.object({ sessionId: v.pipe(v.string(), v.minLength(1)) });

/** The hook and MCP server share this directory under the cueloop state home. */
export function createCodexSessionRegistry(home: string) {
  const directory = join(home, "codex-active-sessions");

  function pathFor(sessionId: string): string {
    const hash = createHash("sha256").update(sessionId).digest("hex");

    return join(directory, `${hash}.json`);
  }

  function activate(sessionId: string): void {
    v.parse(CodexSessionSchema, { sessionId });
    mkdirSync(directory, { recursive: true });
    writeFileSync(pathFor(sessionId), JSON.stringify({ sessionId }));
  }

  function deactivate(sessionId: string): void {
    try {
      unlinkSync(pathFor(sessionId));
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") return;

      throw error;
    }
  }

  function list(): string[] {
    let files: string[];

    try {
      files = readdirSync(directory);
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") return [];

      throw error;
    }

    return files
      .filter((file) => file.endsWith(".json"))
      .map(
        (file) =>
          v.parse(CodexSessionSchema, JSON.parse(readFileSync(join(directory, file), "utf8")))
            .sessionId,
      );
  }

  return { activate, deactivate, list };
}
