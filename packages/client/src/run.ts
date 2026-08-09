/** Real-terminal entry: render the App and resolve when the user quits. */

import React from "react";
import { createCliRenderer } from "@opentui/core";
import { createRoot } from "@opentui/react";
import { App } from "./App";

export interface RunClientOptions {
  sessionId?: string;
  home?: string;
}

export async function runClient(options: RunClientOptions): Promise<number> {
  // mouse movement reporting makes multiplexers forward drags to the app,
  // so the renderer's native selection is the drag driver
  const renderer = await createCliRenderer({ enableMouseMovement: true });
  return new Promise<number>((resolve) => {
    createRoot(renderer).render(
      React.createElement(App, {
        home: options.home,
        sessionId: options.sessionId,
        onExit: (code: number) => {
          renderer.destroy();
          resolve(code);
          // one microtask between destroy and exit lets the renderer flush
          // its terminal-restore sequences before the process dies
          queueMicrotask(() => process.exit(code));
        },
      }),
    );
  });
}
