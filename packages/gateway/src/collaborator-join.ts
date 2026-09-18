/**
 * The collaborator connect-GitHub flow the gateway draws before a shared view:
 * a join splash, then a device-flow connect screen. Returns the verified GitHub
 * identity, or a skip when the collaborator presses escape to stay anonymous.
 */

import {
  resolveCollaboratorIdentity,
  type DeviceFlowDependencies,
  type VerificationPrompt,
} from "./github-device-flow";
import { CUELOOP_LOGO_LINES } from "./brand-logo";

export interface JoinScreenSize {
  cols: number;
  rows: number;
}

/** The minimal SSH channel surface the flow reads keys from and draws onto. */
export interface JoinChannel {
  write: (data: string) => void;
  on(event: "data", listener: (chunk: Buffer) => void): void;
  on(event: "close", listener: () => void): void;
  removeListener(event: "data", listener: (chunk: Buffer) => void): void;
  removeListener(event: "close", listener: () => void): void;
}

export type CollaboratorJoinOutcome =
  | { kind: "identity"; login: string; name?: string }
  | { kind: "skipped" };

export type JoinKey = "enter" | "escape" | "copy" | "other";

const CLEAR_SCREEN = "\x1b[2J\x1b[H";
const HIDE_CURSOR = "\x1b[?25l";
const SHOW_CURSOR = "\x1b[?25h";
const PRIVACY_LINE = "privacy https://cueloop.dev/privacy   support support@cueloop.dev";

/** Classify a keypress from a byte chunk that may coalesce several keys or a paste. */
export function interpretJoinKey(chunk: Buffer): JoinKey {
  // A lone escape (or ctrl-c) skips; an escape that begins a CSI sequence (arrow keys) does not.
  if (chunk.length === 1 && (chunk[0] === 0x1b || chunk[0] === 0x03)) return "escape";

  for (const byte of chunk) {
    if (byte === 0x0d || byte === 0x0a) return "enter";
    if (byte === 0x75 || byte === 0x55) return "copy";
  }

  return "other";
}

function centerBlock(lines: readonly string[], size: JoinScreenSize): string {
  const top = Math.max(0, Math.floor((size.rows - lines.length) / 2));
  let out = CLEAR_SCREEN;

  for (const [index, line] of lines.entries()) {
    const column = Math.max(1, Math.floor((size.cols - [...line].length) / 2) + 1);

    out += `\x1b[${top + index + 1};${column}H${line}`;
  }

  return out;
}

function alignedLogo(): string[] {
  const width = Math.max(...CUELOOP_LOGO_LINES.map((line) => [...line].length));

  return CUELOOP_LOGO_LINES.map((line) => line + " ".repeat(width - [...line].length));
}

/** The first screen: the cueloop mark, a join prompt, and the honest data-use line. */
export function renderJoinSplash(size: JoinScreenSize): string {
  return centerBlock(
    [
      ...alignedLogo(),
      "",
      "cueloop",
      "",
      "enter  join      esc  skip",
      "",
      "Connect GitHub to sign your review comments with your name.",
      "Your GitHub identity links to your SSH key; connection metadata is kept for service security.",
      "",
      PRIVACY_LINE,
    ],
    size,
  );
}

// GitHub routes the code-carrying URL through account selection and drops the code, so the box on the
// next page is empty; the collaborator must type the code, and this screen gives them both parts plainly.
export function renderConnectScreen(
  size: JoinScreenSize,
  prompt: VerificationPrompt,
  copied: boolean,
): string {
  return centerBlock(
    [
      "connect github",
      "",
      "cueloop recognizes you when you return. No account permissions are requested,",
      "and the token is discarded after one identity lookup.",
      "",
      `open this link:   ${prompt.verificationUri}`,
      `enter this code:  ${prompt.userCode}`,
      "",
      copied ? "code copied - paste it on the page" : "u  copy code",
      "",
      "waiting for authorization...",
      "",
      "esc  back",
    ],
    size,
  );
}

/** OSC 52 write so the collaborator's own terminal copies `text` to its clipboard. */
export function clipboardCopySequence(text: string): string {
  return `\x1b]52;c;${Buffer.from(text).toString("base64")}\x07`;
}

function waitForJoinKey(channel: JoinChannel, wanted: readonly JoinKey[]): Promise<JoinKey> {
  return new Promise((resolve) => {
    const listener = (chunk: Buffer): void => {
      const key = interpretJoinKey(chunk);

      if (wanted.includes(key)) {
        channel.removeListener("data", listener);
        resolve(key);
      }
    };

    channel.on("data", listener);
  });
}

/**
 * Draw the two join screens and run the device flow. Escape at either screen
 * returns `skipped` so the collaborator continues anonymously; a completed
 * authorization returns the verified identity. The access token never leaves
 * the device-flow client.
 */
export async function runCollaboratorJoin(options: {
  channel: JoinChannel;
  size: JoinScreenSize;
  clientId: string;
  dependencies: DeviceFlowDependencies;
}): Promise<CollaboratorJoinOutcome> {
  const { channel, size, clientId, dependencies } = options;

  channel.write(HIDE_CURSOR);
  try {
    channel.write(renderJoinSplash(size));
    if ((await waitForJoinKey(channel, ["enter", "escape"])) === "escape") {
      return { kind: "skipped" };
    }
    let prompt: VerificationPrompt | null = null;
    let copied = false;
    const draw = (): void => {
      if (prompt) channel.write(renderConnectScreen(size, prompt, copied));
    };
    let stopKeys = (): void => {};
    const abort = new AbortController();
    const skipped = new Promise<CollaboratorJoinOutcome>((resolve) => {
      const listener = (chunk: Buffer): void => {
        const key = interpretJoinKey(chunk);

        if (key === "escape") {
          abort.abort();
          resolve({ kind: "skipped" });
        } else if (key === "copy" && prompt) {
          copied = true;
          channel.write(clipboardCopySequence(prompt.userCode));
          draw();
        }
      };
      // A disconnect after the flow starts must abort the device-flow polling, not leave it running.
      const onClose = (): void => {
        abort.abort();
        resolve({ kind: "skipped" });
      };

      channel.on("data", listener);
      channel.on("close", onClose);
      stopKeys = () => {
        channel.removeListener("data", listener);
        channel.removeListener("close", onClose);
      };
    });
    // A device-flow error (network, parse) becomes an anonymous skip, never an unhandled rejection.
    const resolved = resolveCollaboratorIdentity(clientId, {
      ...dependencies,
      signal: abort.signal,
      onVerification: (next) => {
        prompt = next;
        draw();
      },
    })
      .then<CollaboratorJoinOutcome>((outcome) =>
        outcome.kind === "identity"
          ? { kind: "identity", login: outcome.login, name: outcome.name }
          : { kind: "skipped" },
      )
      .catch((): CollaboratorJoinOutcome => ({ kind: "skipped" }));
    const outcome = await Promise.race([resolved, skipped]);

    stopKeys();

    return outcome;
  } finally {
    channel.write(SHOW_CURSOR);
  }
}
