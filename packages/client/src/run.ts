/** Real-terminal entry: render the App and resolve when the user quits. */

import React from "react";
import { createCliRenderer } from "@opentui/core";
import { createRoot } from "@opentui/react";
import { App } from "./App";
import { closePrototypeBrowser } from "./prototype-browser";
import type { Appearance } from "./theme-presets";
import { loadConfig } from "./config";
import { perfMark } from "./perf/perf-timings";
import { reportPerfMarks } from "./perf/perf-report";
import { defaultLayout, type LaunchLayout } from "./launch-layout";
import {
  ClientExtensionRegistry,
  loadInstalledClientExtensions,
} from "./client-extension-registry";

export interface RunClientOptions {
  sessionId?: string;
  home?: string;
  /** The layout a create-command opens in; omit to restore the remembered one, then the default. */
  layout?: LaunchLayout;
}

/** OSC background query budget: long enough for a terminal to answer, short enough that one that never
 *  does not stall the launch; a non-answering terminal falls back to dark after this. */
const THEME_QUERY_TIMEOUT_MS = 100;

export async function runClient(options: RunClientOptions): Promise<number> {
  // mouse movement reporting makes multiplexers forward drags to the app,
  // so the renderer's native selection is the drag driver
  // a create-command dictates its layout; a bare inbox launch restores the remembered one, then the
  // default; opening a specific thread carries no layout, so its own pane sync drives the composition
  const layout =
    options.layout ??
    (options.sessionId === undefined ? (loadConfig().ui.layout ?? defaultLayout()) : undefined);
  const renderer = await createCliRenderer({ enableMouseMovement: true });
  const extensionRegistry = new ClientExtensionRegistry();

  void loadInstalledClientExtensions(extensionRegistry).catch((error) => {
    extensionRegistry.reportError(`Client extension discovery: ${String(error)}`);
  });
  // a full screen of measured elements each holds a frame listener; lift the default-10 ceiling so a
  // busy view does not trip a false leak warning, while a runaway subscription still would
  renderer.setMaxListeners(64);
  perfMark("renderer");
  // re-assert mouse reporting on focus-in: a multiplexer can drop it, stranding the pointer in native selection
  renderer.on("focus", () => {
    renderer.useMouse = false;
    renderer.useMouse = true;
  });
  return new Promise<number>((resolve) => {
    let exited = false;
    const shutdown = async (code: number): Promise<void> => {
      if (exited) return;
      exited = true;
      renderer.destroy();
      // close the warm prototype Chromium before exit so it never orphans; the
      // await also gives the renderer time to flush its terminal-restore bytes
      await closePrototypeBrowser();
      resolve(code);
      process.exit(code);
    };

    // a closed pane/terminal hangs up (or the parent kills us); exit instead of
    // lingering as an orphan whose pty read loop keeps burning CPU
    process.once("SIGHUP", () => void shutdown(0));
    process.once("SIGTERM", () => void shutdown(0));

    const root = createRoot(renderer);
    const renderApp = (appearance: Appearance): void => {
      root.render(
        React.createElement(App, {
          home: options.home,
          sessionId: options.sessionId,
          appearance,
          layout,
          extensionRegistry,
          onExit: shutdown,
          onReady: () => {
            perfMark("firstFrame");
            reportPerfMarks("startup");
          },
        }),
      );
    };

    // Paint immediately with the default appearance; the OSC theme query resolves off the
    // first-paint path and upgrades the theme in place when the terminal answers, so launch
    // never blocks on it. A non-answering terminal simply stays dark.
    renderApp("dark");
    perfMark("render");

    void renderer
      .waitForThemeMode(THEME_QUERY_TIMEOUT_MS)
      .then((mode) => {
        perfMark("themeQuery");
        // the query can answer after a fast quit; never render onto a destroyed renderer
        if (!exited && mode && mode !== "dark") renderApp(mode);
      })
      .catch(() => {});
  });
}
