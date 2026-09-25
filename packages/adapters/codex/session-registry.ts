import { linkSync, mkdirSync, readFileSync, readdirSync, unlinkSync, writeFileSync } from "node:fs";
import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { join } from "node:path";
import * as v from "valibot";

const CodexSessionSchema = v.object({
  sessionId: v.pipe(v.string(), v.minLength(1)),
  secret: v.pipe(v.string(), v.minLength(1)),
});

/** The hook and MCP server share this directory under the cueloop state home. */
export function createCodexSessionRegistry(home: string) {
  const directory = join(home, "codex-active-sessions");

  function pathFor(sessionId: string): string {
    const hash = createHash("sha256").update(sessionId).digest("hex");

    return join(directory, `${hash}.json`);
  }

  function activate(sessionId: string, cwd = ""): string {
    const record = v.parse(CodexSessionSchema, {
      sessionId,
      secret: randomBytes(32).toString("hex"),
    });
    const path = pathFor(sessionId);
    const temporaryPath = `${path}.${randomBytes(8).toString("hex")}.tmp`;

    mkdirSync(directory, { recursive: true });
    writeFileSync(temporaryPath, JSON.stringify(record), { mode: 0o600 });

    try {
      try {
        linkSync(temporaryPath, path);
      } catch (error) {
        if (!(error instanceof Error && "code" in error && error.code === "EEXIST")) throw error;
      }
    } finally {
      unlinkSync(temporaryPath);
    }
    const active = v.parse(CodexSessionSchema, JSON.parse(readFileSync(path, "utf8")));

    if (active.sessionId !== sessionId) throw new Error("Codex session record identity mismatch");

    return createHmac("sha256", active.secret).update(cwd).digest("hex");
  }

  function authorized(sessionId: string, cwd: string, token: string): boolean {
    try {
      const record = v.parse(
        CodexSessionSchema,
        JSON.parse(readFileSync(pathFor(sessionId), "utf8")),
      );
      const expected = createHmac("sha256", record.secret).update(cwd).digest();
      const received = Buffer.from(token, "hex");

      return (
        record.sessionId === sessionId &&
        received.length === expected.length &&
        timingSafeEqual(received, expected)
      );
    } catch {
      return false;
    }
  }

  function deactivate(sessionId: string): void {
    try {
      unlinkSync(pathFor(sessionId));
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") {
        return;
      }

      throw error;
    }
  }

  function list(): string[] {
    let files: string[];

    try {
      files = readdirSync(directory);
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") {
        return [];
      }

      throw error;
    }

    const sessionIds: string[] = [];

    for (const file of files) {
      if (!/^[a-f0-9]{64}\.json$/.test(file)) continue;

      try {
        sessionIds.push(
          v.parse(CodexSessionSchema, JSON.parse(readFileSync(join(directory, file), "utf8")))
            .sessionId,
        );
      } catch {
        continue;
      }
    }

    return sessionIds;
  }

  return { activate, authorized, deactivate, list };
}
