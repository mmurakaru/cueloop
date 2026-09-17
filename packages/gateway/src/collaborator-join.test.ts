import { describe, expect, test } from "bun:test";
import {
  clipboardCopySequence,
  interpretJoinKey,
  renderConnectScreen,
  renderJoinSplash,
  runCollaboratorJoin,
} from "./collaborator-join";
import {
  createTestDeviceFlowFetch,
  TEST_GRANT_BODY,
} from "../../../test/helpers/github-device-flow-stubs";
import { createTestJoinChannel } from "../../../test/helpers/join-channel";

const SIZE = { cols: 80, rows: 40 };
const immediateSleep = async (): Promise<void> => {};
const neverSleep = (): Promise<void> => new Promise(() => {});

function tick(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

describe("interpretJoinKey", () => {
  test("classifies enter, escape, copy, and everything else", () => {
    expect(interpretJoinKey(Buffer.from("\r"))).toBe("enter");
    expect(interpretJoinKey(Buffer.from("\n"))).toBe("enter");
    expect(interpretJoinKey(Buffer.from("\x1b"))).toBe("escape");
    expect(interpretJoinKey(Buffer.from("u"))).toBe("copy");
    expect(interpretJoinKey(Buffer.from("x"))).toBe("other");
    expect(interpretJoinKey(Buffer.from("\x1b[A"))).toBe("other");
  });
});

describe("render", () => {
  test("splash shows the mark, the join prompt, and the data-use line", () => {
    const frame = renderJoinSplash(SIZE);

    expect(frame).toContain("cueloop");
    expect(frame).toContain("enter  join");
    expect(frame).toContain("service security");
  });

  test("connect screen shows the assurance, the link, and the copy affordance", () => {
    const prompt = {
      verificationUri: "https://github.com/login/device",
      verificationUriComplete: "https://github.com/login/device?user_code=WXYZ-1234",
      userCode: "WXYZ-1234",
    };

    expect(renderConnectScreen(SIZE, prompt, false)).toContain("connect github");
    expect(renderConnectScreen(SIZE, prompt, false)).toContain(prompt.verificationUriComplete);
    expect(renderConnectScreen(SIZE, prompt, false)).toContain("u  copy url");
    expect(renderConnectScreen(SIZE, prompt, true)).toContain("link copied");
  });

  test("clipboard sequence base64-encodes the url in OSC 52", () => {
    const sequence = clipboardCopySequence("hello");

    expect(sequence).toBe(`\x1b]52;c;${Buffer.from("hello").toString("base64")}\x07`);
  });
});

describe("runCollaboratorJoin", () => {
  test("escape at the splash skips to anonymous", async () => {
    const channel = createTestJoinChannel();
    const { fetch } = createTestDeviceFlowFetch({});
    const pending = runCollaboratorJoin({
      channel,
      size: SIZE,
      clientId: "Iv-1",
      dependencies: { fetch, sleep: immediateSleep },
    });

    channel.emitKey("\x1b");

    expect(await pending).toEqual({ kind: "skipped" });
  });

  test("enter then a completed device flow returns the verified identity", async () => {
    const channel = createTestJoinChannel();
    const { fetch } = createTestDeviceFlowFetch({
      token: [{ access_token: "tok-1" }],
      user: { login: "robin", name: "Robin" },
    });
    const pending = runCollaboratorJoin({
      channel,
      size: SIZE,
      clientId: "Iv-1",
      dependencies: { fetch, sleep: immediateSleep },
    });

    channel.emitKey("\r");

    expect(await pending).toEqual({ kind: "identity", login: "robin", name: "Robin" });
  });

  test("the copy key writes the clipboard sequence and marks the link copied", async () => {
    const channel = createTestJoinChannel();
    const { fetch } = createTestDeviceFlowFetch({});
    const pending = runCollaboratorJoin({
      channel,
      size: SIZE,
      clientId: "Iv-1",
      dependencies: { fetch, sleep: neverSleep },
    });

    channel.emitKey("\r");
    await tick();
    channel.emitKey("u");
    const copied = clipboardCopySequence(TEST_GRANT_BODY.verification_uri_complete);

    expect(channel.writes.some((frame) => frame.includes(copied))).toBe(true);
    expect(channel.writes.some((frame) => frame.includes("link copied"))).toBe(true);

    channel.emitKey("\x1b");
    expect(await pending).toEqual({ kind: "skipped" });
  });
});
