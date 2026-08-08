/** Real-terminal entry: render the App and resolve when the user quits. */

import React from "react";
import { createCliRenderer } from "@opentui/core";
import { createRoot } from "@opentui/react";
import { App } from "./App";

export interface RunClientOptions {
  sessionId?: string;
  home?: string;
}

export async function runClient(opts: RunClientOptions): Promise<number> {
  // mouse movement reporting makes multiplexers forward drags to the app,
  // so the renderer's native selection is the drag driver
  const renderer = await createCliRenderer({ enableMouseMovement: true });
  return new Promise<number>((resolve) => {
    createRoot(renderer).render(
      React.createElement(App, {
        home: opts.home,
        sessionId: opts.sessionId,
        onExit: (code: number) => {
          renderer.destroy();
          resolve(code);
          process.exit(code);
        },
      }),
    );
  });
}
