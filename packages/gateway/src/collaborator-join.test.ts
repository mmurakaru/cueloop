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

  test("finds a recognized key inside a coalesced or pasted chunk", () => {
    expect(interpretJoinKey(Buffer.from("\x1b[Ax\r"))).toBe("enter");
    expect(interpretJoinKey(Buffer.from("paste-u"))).toBe("copy");
    expect(interpretJoinKey(Buffer.from("no-keys-here"))).toBe("other");
  });
});

describe("render", () => {
  test("splash shows the mark, the join prompt, and the data-use line", () => {
    const frame = renderJoinSplash(SIZE);

    expect(frame).toContain("cueloop");
    expect(frame).toContain("enter  join");
    expect(frame).toContain("service security");
  });

  test("the logo lines share one column so the art stays aligned, like the install script", () => {
    const escape = String.fromCharCode(27);
    const logoColumns = renderJoinSplash(SIZE)
      .split(escape)
      .map((segment) => segment.match(/^\[\d+;(\d+)H([^]*)$/))
      .filter((match) => match !== null && /[⠀-⣿]/.test(match[2]!))
      .map((match) => Number(match![1]));

    expect(logoColumns.length).toBeGreaterThan(1);
    expect(new Set(logoColumns).size).toBe(1);
  });

  test("story: the join splash", () => {
    expect(renderJoinSplash(SIZE)).toMatchSnapshot();
  });

  test("story: the connect screen with the browser link", () => {
    const prompt = {
      verificationUri: "https://github.com/login/device",
      verificationUriComplete: "https://github.com/login/device?user_code=WXYZ-1234",
      userCode: "WXYZ-1234",
    };

    expect(renderConnectScreen(SIZE, prompt, false)).toMatchSnapshot();
    expect(renderConnectScreen(SIZE, prompt, true)).toMatchSnapshot();
  });

  test("connect screen shows the assurance, the link, the code, and the copy affordance", () => {
    const prompt = {
      verificationUri: "https://github.com/login/device",
      verificationUriComplete: "https://github.com/login/device?user_code=WXYZ-1234",
      userCode: "WXYZ-1234",
    };

    expect(renderConnectScreen(SIZE, prompt, false)).toContain("connect github");
    expect(renderConnectScreen(SIZE, prompt, false)).toContain(prompt.verificationUri);
    expect(renderConnectScreen(SIZE, prompt, false)).toContain(prompt.userCode);
    expect(renderConnectScreen(SIZE, prompt, false)).toContain("u  copy code");
    expect(renderConnectScreen(SIZE, prompt, true)).toContain("code copied");
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

  test("a device-flow failure resolves to anonymous, never rejecting", async () => {
    const channel = createTestJoinChannel();
    const fetch = async (): Promise<Response> => {
      throw new Error("github unreachable");
    };
    const pending = runCollaboratorJoin({
      channel,
      size: SIZE,
      clientId: "Iv-1",
      dependencies: { fetch, sleep: immediateSleep },
    });

    channel.emitKey("\r");

    expect(await pending).toEqual({ kind: "skipped" });
  });

  test("a disconnect while the device flow is pending aborts it and resolves to anonymous", async () => {
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
    channel.emitClose();

    expect(await pending).toEqual({ kind: "skipped" });
  });

  test("the copy key writes the clipboard sequence and marks the code copied", async () => {
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
    const copied = clipboardCopySequence(TEST_GRANT_BODY.user_code);

    expect(channel.writes.some((frame) => frame.includes(copied))).toBe(true);
    expect(channel.writes.some((frame) => frame.includes("code copied"))).toBe(true);

    channel.emitKey("\x1b");
    expect(await pending).toEqual({ kind: "skipped" });
  });
});
