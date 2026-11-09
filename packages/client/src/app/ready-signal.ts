/** Announces readiness after a usable frame and its queued terminal output have completed. */

import { writeFileSync } from "node:fs";
import { useEffect, useRef } from "react";
import { useRenderer } from "@opentui/react";

export const READY_FILE_ENV = "CUELOOP_READY_FILE";

function announceReady(): void {
  const path = process.env[READY_FILE_ENV];

  if (!path) return;

  writeFileSync(path, "ready\n");
}

export function useReadySignal(ready: boolean, onReady?: () => void): void {
  const renderer = useRenderer();
  const fired = useRef(false);

  useEffect(() => {
    if (!ready || fired.current) return;

    let cancelled = false;
    let cancelPresentation: (() => void) | undefined;
    const emit = (): void => {
      const liveFrame = Promise.withResolvers<void>();
      const onLiveFrame = (): void => {
        if (renderer.isRunning) queueMicrotask(liveFrame.resolve);
      };

      cancelPresentation = () => {
        renderer.off("frame", onLiveFrame);
        liveFrame.resolve();
      };
      renderer.on("frame", onLiveFrame);
      onLiveFrame();
      // Live scenes present usable frames without ever becoming globally idle.
      const idle = renderer.isRunning ? Promise.resolve() : renderer.idle();

      void Promise.race([idle, liveFrame.promise]).then(
        () => {
          cancelPresentation?.();

          if (cancelled || fired.current || renderer.isDestroyed) return;

          fired.current = true;
          announceReady();
          onReady?.();
        },
        (cause) => {
          cancelPresentation?.();

          if (!cancelled && !renderer.isDestroyed)
            console.error("App readiness output failed", cause);
        },
      );
    };

    renderer.once("frame", emit);

    return () => {
      cancelled = true;
      cancelPresentation?.();
      renderer.off("frame", emit);
    };
  }, [ready, renderer, onReady]);
}
