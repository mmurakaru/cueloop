/**
 * The app ready signal: fired once, after the first frame that paints a
 * usable screen (a session, the no-thread shell, or an error) has been
 * flushed. React runs child effects before parent effects, so by the time the
 * App-level effect arms the frame listener every keyboard handler of that
 * first screen is already subscribed - a key sent after the signal cannot be
 * dropped. Surfaces that mount later (a composer, a lazily loaded tab) still
 * need their own screen predicate. Tests wait on this instead of guessing
 * from output silence. Two channels: an
 * `onReady` callback for in-process suites, and the file named by
 * CUELOOP_READY_FILE for subprocess and PTY suites. Users never see either.
 */

import { writeFileSync } from "node:fs";
import { useEffect, useRef } from "react";
import { useRenderer } from "@opentui/react";

/** The env var naming the file the app writes once it is ready; unset in normal use. */
export const READY_FILE_ENV = "CUELOOP_READY_FILE";

/** Write the ready file when CUELOOP_READY_FILE names one; a no-op otherwise, so the signal costs nothing outside tests. */
function announceReady(): void {
  const path = process.env[READY_FILE_ENV];

  if (!path) return;
  writeFileSync(path, "ready\n");
}

/**
 * Fire the ready signal once, on the first rendered frame after `ready`
 * turns true. Call it after every keyboard hook of the component so their
 * subscriptions are in place when the signal goes out.
 */
export function useReadySignal(ready: boolean, onReady?: () => void): void {
  const renderer = useRenderer();
  const fired = useRef(false);

  useEffect(() => {
    if (!ready || fired.current) return;
    const emit = (): void => {
      fired.current = true;
      announceReady();
      onReady?.();
    };

    renderer?.once("frame", emit);

    return () => {
      renderer?.off("frame", emit);
    };
  }, [ready, renderer, onReady]);
}
