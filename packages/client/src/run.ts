/** Real-terminal entry: render the App and resolve when the user quits. */

import React from "react";
import { createCliRenderer } from "@opentui/core";
import { createRoot } from "@opentui/react";
import { App } from "./App";
import { loadConfig } from "./config";
import { perfMark } from "./perf/perf-timings";
import { reportPerfMarks } from "./perf/perf-report";
import { defaultLayout, type LaunchLayout } from "./launch-layout";

export interface RunClientOptions {
  sessionId?: string;
  home?: string;
  /** The layout a create-command opens in; omit to restore the remembered one, then the default. */
  layout?: LaunchLayout;
}

/** OSC background query budget: brief so a terminal that never answers falls back to dark. */
const THEME_QUERY_TIMEOUT_MS = 200;

export async function runClient(options: RunClientOptions): Promise<number> {
  // mouse movement reporting makes multiplexers forward drags to the app,
  // so the renderer's native selection is the drag driver
  // a create-command dictates its layout; a bare inbox launch restores the remembered one, then the
  // default; opening a specific thread carries no layout, so its own pane sync drives the composition
  const layout =
    options.layout ??
    (options.sessionId === undefined ? (loadConfig().ui.layout ?? defaultLayout()) : undefined);
  const renderer = await createCliRenderer({ enableMouseMovement: true });
  perfMark("renderer");
  // re-assert mouse reporting on focus-in: a multiplexer can drop it, stranding the pointer in native selection
  renderer.on("focus", () => {
    renderer.useMouse = false;
    renderer.useMouse = true;
  });
  const appearance =
    (await renderer.waitForThemeMode(THEME_QUERY_TIMEOUT_MS).catch(() => null)) ?? "dark";
  perfMark("themeQuery");

  return new Promise<number>((resolve) => {
    let exited = false;
    const shutdown = (code: number): void => {
      if (exited) return;
      exited = true;
      renderer.destroy();
      resolve(code);
      // one microtask between destroy and exit lets the renderer flush
      // its terminal-restore sequences before the process dies
      queueMicrotask(() => process.exit(code));
    };

    // a closed pane/terminal hangs up (or the parent kills us); exit instead of
    // lingering as an orphan whose pty read loop keeps burning CPU
    process.once("SIGHUP", () => shutdown(0));
    process.once("SIGTERM", () => shutdown(0));

    createRoot(renderer).render(
      React.createElement(App, {
        home: options.home,
        sessionId: options.sessionId,
        appearance,
        layout,
        onExit: shutdown,
        onReady: () => {
          perfMark("firstFrame");
          reportPerfMarks("startup");
        },
      }),
    );
    perfMark("render");
  });
}
