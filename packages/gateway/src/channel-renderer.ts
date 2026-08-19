/**
 * The channel-to-renderer bridge: turn a raw ssh2 shell channel into a running
 * OpenTUI renderer, then mount a React element on it. This is the ~100 lines
 * `@opentui/ssh` seals inside its bundle; we own it here so the same server can
 * also branch an `exec` channel to the upload path (which `@opentui/ssh` can't).
 *
 * The channel is one duplex stream. We wrap it as a Readable (client -> app,
 * with pause/resume backpressure) and a Writable (app -> client, with drain
 * backpressure), carry the PTY size as explicit width/height, and mirror
 * `window-change` onto `renderer.resize`. Teardown unmounts React and destroys
 * the renderer exactly once, whether the client hangs up or the app exits.
 */

import { Readable, Writable } from "node:stream";
import type { ReactElement } from "react";
import { createCliRenderer } from "@opentui/core";
import { createRoot } from "@opentui/react";
import type { ServerChannel } from "ssh2";

/**
 * Terminal restore bytes: disable mouse reporting (?1000/1002/1003/1006), show
 * the cursor (?25), and leave the alt screen (?1049). The renderer emits these
 * on destroy, but that only runs after the channel closes - too late, so the
 * graceful teardown writes them explicitly while the channel is still open, or
 * the client is left spewing SGR mouse reports until `reset`.
 */
export const TERMINAL_RESTORE = "\x1b[?1000l\x1b[?1002l\x1b[?1003l\x1b[?1006l\x1b[?25h\x1b[?1049l";

export interface PtySize {
  cols: number;
  rows: number;
}

export interface ChannelRender {
  /** Mirror an SSH window-change onto the renderer. */
  resize(size: PtySize): void;
  /** Unmount React and destroy the renderer; idempotent. */
  destroy(): void;
}

/** Wrap the duplex channel as the stdin/stdout pair a renderer expects. */
function channelStreams(channel: ServerChannel, size: PtySize) {
  let inputPaused = false;
  const stdin = new Readable({
    read() {
      if (!inputPaused) return;
      inputPaused = false;
      channel.resume();
    },
  });
  const onData = (chunk: Buffer) => {
    if (!stdin.push(chunk)) {
      inputPaused = true;
      channel.pause();
    }
  };
  channel.on("data", onData);

  let channelGone = false;
  let pendingDrain: (() => void) | null = null;
  const releaseDrain = () => {
    const done = pendingDrain;
    pendingDrain = null;
    done?.();
  };
  channel.on("close", () => ((channelGone = true), releaseDrain()));
  channel.on("error", () => ((channelGone = true), releaseDrain()));

  const stdout = new Writable({
    write(chunk, _encoding, callback) {
      if (channelGone) return callback();
      const bytes = Buffer.from(chunk);
      if (bytes.byteLength === 0) return callback();
      if (channel.write(bytes)) return callback();
      pendingDrain = callback;
      channel.once("drain", releaseDrain);
    },
  }) as Writable & { columns: number; rows: number };
  stdout.columns = size.cols;
  stdout.rows = size.rows;

  return { stdin, stdout, detach: () => channel.removeListener("data", onData) };
}

/** Render `element` onto the ssh2 channel and return its resize/teardown handle. */
export async function renderOverChannel(
  channel: ServerChannel,
  size: PtySize,
  element: ReactElement,
): Promise<ChannelRender> {
  const { stdin, stdout, detach } = channelStreams(channel, size);
  const renderer = await createCliRenderer({
    // The renderer only touches the read/write subset these streams provide;
    // the channel is not a real TTY, so we assert the shape @opentui/core wants.
    stdin: stdin as unknown as NodeJS.ReadStream,
    stdout: stdout as unknown as NodeJS.WriteStream,
    width: size.cols,
    height: size.rows,
    exitOnCtrlC: false,
    exitSignals: [],
    consoleMode: "disabled",
    targetFps: 30,
  });
  const root = createRoot(renderer);
  root.render(element);

  let destroyed = false;
  const destroy = () => {
    if (destroyed) return;
    destroyed = true;
    detach();
    try {
      root.unmount();
    } finally {
      void renderer.destroy();
    }
  };
  channel.once("close", destroy);

  return {
    resize(next) {
      stdout.columns = next.cols;
      stdout.rows = next.rows;
      renderer.resize(next.cols, next.rows);
    },
    destroy,
  };
}
