/**
 * SSH-served TUI: `cueloop serve` lets teammates join a
 * review session over plain ssh. Every SSH connection renders <App> in
 * observer mode (readOnly) against the same local daemon; the one writable
 * controller stays the local owner's own `cueloop` TUI.
 *
 * Trust model - tunnel of trust, no passwords, no keys:
 * the server authenticates nobody ("open" auth). Access control is the act of
 * sharing the address deliberately: it binds to 127.0.0.1 by default, so a
 * remote teammate reaches it only through a channel the owner opened on
 * purpose (an SSH tunnel, a tailnet address via --host). Anyone who can reach
 * the port can watch - and only watch: observers cannot mutate the session.
 * The host key is generated once under CUELOOP_HOME/ssh/host_key (0600) so
 * fingerprints stay stable across restarts.
 */

import { mkdirSync } from "node:fs";
import { join } from "node:path";
import React from "react";
import { createRoot } from "@opentui/react";
import { createServer } from "@opentui/ssh";
import { cueloopHome } from "@cueloop/daemon";
import { App } from "./App";

/** OSC background query budget: brief so a terminal that never answers falls back to dark. */
const THEME_QUERY_TIMEOUT_MS = 200;

export interface ServeOptions {
  /** TCP port for the SSH listener; 0 picks an ephemeral port. Default 2222. */
  port?: number;
  /** Bind address. Default 127.0.0.1 - widen deliberately (e.g. a tailnet IP). */
  host?: string;
  /** Open every connection on this session; omit for the inbox. */
  sessionId?: string;
  /** CUELOOP_HOME override (daemon socket + ssh host key live under it). */
  home?: string;
  /** Silence the @opentui/ssh startup banner (tests). Default true. */
  banner?: boolean;
  onError?: (cause: unknown) => void;
}

export interface ServeHandle {
  host: string;
  port: number;
  /** SHA256 host-key fingerprints, for out-of-band verification. */
  fingerprints: string[];
  close(): Promise<void>;
}

export async function serveClient(options: ServeOptions = {}): Promise<ServeHandle> {
  const home = options.home ?? cueloopHome();
  const sshDir = join(home, "ssh");

  mkdirSync(sshDir, { recursive: true, mode: 0o700 });

  const server = createServer({
    // password-less by design; see the trust model in the module comment
    auth: "open",
    hostKey: { path: join(sshDir, "host_key") },
    startupBanner: options.banner ?? true,
    idleTimeout: "2h",
    onError: options.onError,
  }).serve(async (session) => {
    // the observer's terminal reports its own background, so a light-terminal
    // watcher gets the readable variant too
    const appearance =
      (await session.renderer.waitForThemeMode(THEME_QUERY_TIMEOUT_MS).catch(() => null)) ?? "dark";
    const root = createRoot(session.renderer);

    root.render(
      React.createElement(App, {
        home,
        sessionId: options.sessionId,
        readOnly: true,
        appearance,
        // q disconnects only this observer, never the server
        onExit: () => session.end(),
      }),
    );
    session.onClose(() => root.unmount());
  });

  const info = await server.listen(options.port ?? 2222, options.host ?? "127.0.0.1");

  return { ...info, close: () => server.close() };
}
