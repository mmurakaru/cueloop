/** Claude Code inbox wire format: the exact two newline-delimited frames a post sends (matched against cc's own embedded example), env parsing, and a real post captured by a fake unix socket server. */

import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { claudeInboxFromEnv, inboxFrames, postToInbox } from "./inbox";

describe("inboxFrames", () => {
  test("auth line then user message, both newline-delimited, matching cc's example", () => {
    // Act
    const frames = inboxFrames("hello", "tok-123");

    // Assert - byte-for-byte the shape from `claude --help` (v2.1.238)
    expect(frames).toBe(
      '{"type":"auth","token":"tok-123"}\n' +
        '{"type":"user","message":{"role":"user","content":"hello"}}\n',
    );
  });

  test("omits the auth line when no token is exported (Linux own-child by process evidence)", () => {
    // Act
    const frames = inboxFrames("hi");

    // Assert
    expect(frames).toBe('{"type":"user","message":{"role":"user","content":"hi"}}\n');
  });

  test("content with quotes and newlines is JSON-escaped, not concatenated raw", () => {
    // Act
    const frames = inboxFrames('a "quote"\nand a newline', "t");

    // Assert - exactly two physical lines survive; the message newline is escaped inside JSON
    const lines = frames.split("\n").filter((line) => line.length > 0);
    expect(lines.length).toBe(2);
    expect(JSON.parse(lines[1]!).message.content).toBe('a "quote"\nand a newline');
  });
});

describe("claudeInboxFromEnv", () => {
  test("reads socket and token from the environment", () => {
    expect(
      claudeInboxFromEnv({
        CLAUDE_CODE_MESSAGING_SOCKET: "/tmp/x.sock",
        CLAUDE_CODE_MESSAGING_TOKEN: "abc",
      }),
    ).toEqual({ socketPath: "/tmp/x.sock", token: "abc" });
  });

  test("strips the uds: prefix a /status path carries", () => {
    expect(claudeInboxFromEnv({ CLAUDE_CODE_MESSAGING_SOCKET: "uds:/tmp/x.sock" })).toEqual({
      socketPath: "/tmp/x.sock",
      token: undefined,
    });
  });

  test("null outside a messaging-enabled session", () => {
    expect(claudeInboxFromEnv({})).toBeNull();
  });
});

describe("postToInbox", () => {
  let dir: string;
  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  test("writes the auth and user frames to the session's own socket, then closes", async () => {
    // Arrange - a fake inbox server captures every byte it receives
    dir = mkdtempSync(join(tmpdir(), "cc-inbox-"));
    const socketPath = join(dir, "s.sock");
    let received = "";
    const closed = Promise.withResolvers<void>();
    const server = Bun.listen({
      unix: socketPath,
      socket: {
        data: (_socket, data) => {
          received += data.toString();
        },
        close: () => closed.resolve(),
        open: () => {},
      },
    });

    // Act
    await postToInbox({ socketPath, token: "tok-xyz" }, "verdict: approved");
    await closed.promise;
    server.stop();

    // Assert
    expect(received).toBe(
      '{"type":"auth","token":"tok-xyz"}\n' +
        '{"type":"user","message":{"role":"user","content":"verdict: approved"}}\n',
    );
  });

  test("rejects when the socket is dead (the session is gone)", async () => {
    dir = mkdtempSync(join(tmpdir(), "cc-inbox-dead-"));
    const socketPath = join(dir, "nope.sock");
    await expect(postToInbox({ socketPath }, "x")).rejects.toBeDefined();
  });
});
